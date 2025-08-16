"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CandlesChart, { Candle as ChartCandle, Trade as ChartTrade } from "@/app/components/CandlesChart";
import { useTraderStore } from "@/store/trader";
import { getClientId } from "@/lib/clientId";
import { fetchTrades } from "@/lib/api";

/* ================= Types & consts ================= */
type InstType = "SPOT" | "SWAP" | "FUTURES";
type OkxArg = { channel: string; instId: string };
type OkxCandleMsg = { arg: OkxArg; data: string[][] };
type OkxEvent =
    | { event: "subscribe" | "unsubscribe" | "error"; code?: string; msg?: string; arg?: OkxArg }
    | Record<string, unknown>;

const WS_URL = "wss://ws.okx.com:8443/ws/v5/business";
const TF_MAP = { "1m": "candle1m", "5m": "candle5m", "15m": "candle15m" } as const;
type TF = keyof typeof TF_MAP;

type Candle = ChartCandle & { confirm?: "0" | "1" };

const nf2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });
const nf4 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const dtFmt = new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

type Settings = {
    emaFast: number; emaSlow: number; takeProfit: number; stopLoss: number; feeRate: number; slippage: number; maxBars: number;
};

/* ================= Utils ================= */
function inferInstType(id: string): InstType {
    if (id.endsWith("-SWAP")) return "SWAP";
    if (/.*-\d{6}$/.test(id)) return "FUTURES";
    return "SPOT";
}

async function existsInstId(id: string) {
    const instType = inferInstType(id);
    const url = `https://www.okx.com/api/v5/public/instruments?instType=${instType}`;
    try {
        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json();
        return Array.isArray(json.data) && json.data.some((i: any) => i.instId === id);
    } catch {
        return false;
    }
}

// <<<<<< БЕЗПЕЧНИЙ MERGE (ГАРДИ ПРОТИ НЕ-МАСИВІВ)
function mergeTrades(local: ChartTrade[], fromDb: any): ChartTrade[] {
    const rows: any[] = Array.isArray(fromDb) ? fromDb : (Array.isArray(fromDb?.items) ? fromDb.items : []);
    const mapped: ChartTrade[] = rows.map((t) => ({
        side: t.side,
        price: Number(t.price),
        qty: Number(t.qty),
        ts: Number(t.ts),
        pnlUSDT: t.pnlUSDT !== undefined ? Number(t.pnlUSDT) : undefined,
    }));

    const key = (x: ChartTrade) => `${x.side}|${x.ts}|${x.price}|${x.qty}`;
    const seen = new Set<string>();
    const out: ChartTrade[] = [];
    [...local, ...mapped].forEach((t) => {
        const k = key(t);
        if (!seen.has(k)) { seen.add(k); out.push(t); }
    });
    out.sort((a, b) => a.ts - b.ts);
    return out;
}

// OKX row: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
function parseCandleRow(row: string[]): Candle | null {
    try {
        const [ts, o, h, l, c, vol, _v1, _v2, confirm] = row;
        return {
            ts: Number(ts),
            open: Number(o),
            high: Number(h),
            low: Number(l),
            close: Number(c),
            vol: Number(vol),
            confirm: confirm === "1" ? "1" : "0",
        };
    } catch {
        return null;
    }
}

// EMA
function emaNext(prev: number | undefined, price: number, period: number): number {
    const alpha = 2 / (period + 1);
    return prev === undefined ? price : prev + alpha * (price - prev);
}

/* ================= Trading simulation ================= */
type Position = { entry: number; qty: number; entryTs: number };
type Trade = ChartTrade;
type PendingOrder = { side: "BUY" | "SELL"; forTs: number } | null;

type SimState = {
    cashUSDT: number;
    position: Position | null;
    equityUSDT: number;
    trades: Trade[];
    ema12?: number;
    ema26?: number;
    lastClosedTs?: number;
    pending?: PendingOrder;
};

const FEE_RATE = 0.001;
const SLIPPAGE = 0.0005;

function computeEquity(state: SimState, mark: number): number {
    if (!state.position) return state.cashUSDT;
    return state.cashUSDT + state.position.qty * mark;
}

async function saveTradeToDB(t: Trade & { instId: string; tf: string }) {
    try {
        await fetch("/api/trades", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...t, createdAt: new Date().toISOString() }),
        });
    } catch (e) {
        console.error("saveTradeToDB", e);
    }
}

function tryEnter(state: SimState, price: number, ts: number): SimState {
    if (state.position || state.cashUSDT <= 0) return state;
    const qty = (state.cashUSDT * (1 - FEE_RATE)) / price;
    const pos: Position = { entry: price, qty, entryTs: ts };
    const buy: Trade = { side: "BUY", price, qty, ts };
    const next: SimState = {
        ...state,
        cashUSDT: 0,
        position: pos,
        trades: [...state.trades, buy],
    };
    next.equityUSDT = computeEquity(next, price);
    return next;
}

function tryExit(state: SimState, price: number, ts: number): SimState {
    if (!state.position) return state;
    const { qty, entry } = state.position;
    const grossProceeds = qty * price;
    const netProceeds = grossProceeds * (1 - FEE_RATE);
    const cost = qty * entry;
    const pnl = netProceeds - cost;

    const sell: Trade = { side: "SELL", price, qty, ts, pnlUSDT: pnl };
    const cash = state.cashUSDT + netProceeds;
    const next: SimState = {
        ...state,
        cashUSDT: cash,
        position: null,
        trades: [...state.trades, sell],
    };
    next.equityUSDT = computeEquity(next, price);
    return next;
}

function execAtOpen(next: SimState, side: "BUY" | "SELL", open: number, ts: number): SimState {
    const px = side === "BUY" ? open * (1 + SLIPPAGE) : open * (1 - SLIPPAGE);
    return side === "BUY" ? tryEnter(next, px, ts) : tryExit(next, px, ts);
}

/* ================= Component ================= */
export default function Bot() {
    const [instId, setInstId] = useState<string>("BTC-USDT");
    const [tf, setTf] = useState<TF>("1m");

    const [status, setStatus] = useState<"idle" | "checking" | "connecting" | "open" | "closed" | "error">("idle");
    const [err, setErr] = useState<string | null>(null);

    const [last, setLast] = useState<Candle | null>(null);
    const [candles, setCandles] = useState<Candle[]>([]);
    const [packets, setPackets] = useState<number>(0);

    const [sim, setSim] = useState<SimState>(() => ({
        cashUSDT: 100,
        position: null,
        equityUSDT: 100,
        trades: [],
        ema12: undefined,
        ema26: undefined,
        lastClosedTs: undefined,
        pending: null,
    }));
    const [isLeader, setIsLeader] = useState(false);
    const [settings, setSettings] = useState<Settings>({
        emaFast: 12, emaSlow: 26, takeProfit: 0.04, stopLoss: 0.02, feeRate: 0.001, slippage: 0.0005, maxBars: 400
    });
    const clientIdRef = useRef<string>("");

    const FAST = settings.emaFast;
    const SLOW = settings.emaSlow;
    const TAKE_PROFIT = settings.takeProfit;
    const STOP_LOSS = settings.stopLoss;
    const FEE_RATE = settings.feeRate;
    const SLIPPAGE = settings.slippage;
    const MAX_BARS = settings.maxBars;

    const { simSnapshot, setSimSnapshot } = useTraderStore();


    // завантаження налаштувань і clientId

    useEffect(() => {
        if (isLeader) return; // лідер сам пише, йому pull не потрібен
        const id = setInterval(async () => {
            try {
                const [rState, rTrades] = await Promise.all([
                    fetch("/api/state", { cache: "no-store" }),
                    fetch("/api/trades?since=" + new Date(Date.now() - 3600 * 1000).toISOString(), { cache: "no-store" }),
                ]);
                const doc = await rState.json();
                if (doc?.sim) {
                    setSim(doc.sim);
                    setCandles(doc.candles || []);
                    if (doc.instId) setInstId(doc.instId);
                    if (doc.tf && ["1m", "5m", "15m"].includes(doc.tf)) setTf(doc.tf);
                }

                // trades не обов'язково зливати в локальний sim, ми їх уже малюємо з sim.trades;
                // якщо хочеш таблицю з БД — зробимо окремий компонент /history.
            } catch { }

            // 3) Історія трейдів із Mongo (останні 2000, order=asc)
            try {
                const rows = await fetchTrades({ limit: 2000, order: "asc" });
                setSim(prev => ({ ...prev, trades: mergeTrades(prev.trades, rows) }));
            } catch (e) {
                console.warn("fetchTrades initial failed:", e);
            }


        }, 20_000);
        return () => clearInterval(id);

    }, [isLeader]);

    useEffect(() => {
        if (isLeader) return; // лідер сам пише трейди, йому pull не треба
        let stop = false;

        async function pullNew() {
            try {
                // візьмемо останні від 15 хвилин — надійно й небагато
                const sinceIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
                const rows = await fetchTrades({ since: sinceIso, order: "asc", limit: 2000 });
                if (!stop && rows?.length) {
                    setSim(prev => ({ ...prev, trades: mergeTrades(prev.trades, rows) }));
                }
            } catch { }
        }

        pullNew();
        const id = setInterval(pullNew, 20_000);
        return () => { stop = true; clearInterval(id); };
    }, [isLeader, setSim]);



    useEffect(() => {
        clientIdRef.current = getClientId();
        (async () => {
            try {
                const r = await fetch("/api/settings", { cache: "no-store" });
                const s = await r.json();
                setSettings(s);
                // можеш також підставити їх у локальні константи, якщо тримаєш окремо FAST/SLOW/TP/SL/fee/slippage
            } catch { }
        })();
    }, []);

    // аутсорс

    useEffect(() => {
        let stop = false;
        async function renewLease() {
            try {
                const res = await fetch("/api/lease", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ holderId: clientIdRef.current }),
                });
                const data = await res.json();
                if (!stop) setIsLeader(Boolean(data.acquired));
            } catch {
                if (!stop) setIsLeader(false);
            }
        }
        renewLease();
        const id = setInterval(renewLease, 30_000);
        return () => { stop = true; clearInterval(id); };
    }, []);



    // refs
    const simRef = useRef(sim);
    useEffect(() => { simRef.current = sim; }, [sim]);
    const lastBarTsRef = useRef<number | null>(null);

    const channel = TF_MAP[tf];
    const arg: OkxArg = useMemo(() => ({ channel, instId }), [channel, instId]);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<number | null>(null);

    // Обробка ЗАКРИТОЇ свічки → сигнали + pending
    const onClosedCandle = useCallback((c: Candle) => {
        setSim((prev) => {
            if (prev.lastClosedTs === c.ts) return prev;

            const ema12 = emaNext(prev.ema12, c.close, FAST);
            const ema26 = emaNext(prev.ema26, c.close, SLOW);

            let next: SimState = { ...prev, ema12, ema26, lastClosedTs: c.ts };

            const wasAbove = prev.ema12 !== undefined && prev.ema26 !== undefined && prev.ema12 > prev.ema26;
            const isAbove = ema12 > ema26;

            // стоп/тейк на close закритої свічки
            if (next.position) {
                const pnlPct = (c.close - next.position.entry) / next.position.entry;
                if (pnlPct >= TAKE_PROFIT || pnlPct <= -STOP_LOSS) {
                    next = tryExit(next, c.close, c.ts);
                }
            }

            // формуємо pending на наступну свічку

            if (isLeader) {
                // формуємо pending...
                if (!next.position && wasAbove === false && isAbove === true) {
                    console.log("[SIGNAL] BUY on close", new Date(c.ts).toISOString(), c.close);
                    next.pending = { side: "BUY", forTs: c.ts };
                } else if (next.position && wasAbove === true && isAbove === false) {
                    console.log("[SIGNAL] SELL on close", new Date(c.ts).toISOString(), c.close);
                    next.pending = { side: "SELL", forTs: c.ts };
                }
            }

            next.equityUSDT = computeEquity(next, c.close);
            return next;
        });
    }, []);

    // Стабільний connect: залежить тільки від instId/TF (через arg.*)
    const connect = useCallback(() => {
        if (wsRef.current) {
            try { wsRef.current.close(); } catch { }
            wsRef.current = null;
        }
        setStatus("connecting"); setErr(null);

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.addEventListener("open", () => {
            setStatus("open");
            ws.send(JSON.stringify({ op: "subscribe", args: [arg] }));
        });

        ws.addEventListener("message", (evt) => {
            try {
                const parsed = JSON.parse(String(evt.data)) as OkxEvent | OkxCandleMsg;

                if ("event" in parsed && parsed.event === "error") {
                    setErr(`OKX WS error: ${parsed.code ?? ""} ${parsed.msg ?? ""}`.trim() || "WS error");
                    return;
                }

                if ("arg" in parsed && "data" in parsed && Array.isArray(parsed.data)) {
                    const rows = parsed.data as string[][];
                    const row = rows[rows.length - 1];
                    const candle = parseCandleRow(row);
                    if (!candle) return;

                    setPackets((n) => n + 1);
                    setLast(candle);

                    setCandles((prev) => {
                        const isSame = prev.length > 0 && prev[prev.length - 1].ts === candle.ts;
                        const next = isSame ? [...prev.slice(0, -1), candle] : [...prev, candle];
                        if (next.length > MAX_BARS) next.shift();
                        return next;
                    });

                    // Виконання pending на відкритті нової свічки
                    const isNewBar = lastBarTsRef.current !== candle.ts;
                    if (isNewBar && isLeader && simRef.current?.pending) {
                        const p = simRef.current.pending!;
                        console.log("[EXEC] at next open", p.side, new Date(candle.ts).toISOString(), "open:", candle.open);

                        setSim((prev) => {
                            let after = execAtOpen(prev, p.side, candle.open, candle.ts);
                            after.pending = null;
                            after.equityUSDT = computeEquity(after, candle.close);
                            return after;
                        });
                    }

                    if (candle.confirm === "1") onClosedCandle(candle);
                    else setSim((prev) => ({ ...prev, equityUSDT: computeEquity(prev, candle.close) }));

                    lastBarTsRef.current = candle.ts; // оновлюємо тільки тут
                }
            } catch (e) {
                setErr(`Parse error: ${(e as Error).message}`);
            }
        });

        ws.addEventListener("error", () => { setStatus("error"); setErr("WebSocket error"); });
        ws.addEventListener("close", () => {
            setStatus("closed");
            if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
            reconnectTimer.current = window.setTimeout(() => connect(), 2000) as unknown as number;
        });
    }, [arg.instId, arg.channel, onClosedCandle]);

    // Відновлення з локального стора / Mongo (опційно)
    useEffect(() => {
        (async () => {
            if (simSnapshot) {
                setSim(simSnapshot.sim);
                setCandles(simSnapshot.candles || []);
                if (simSnapshot.instId) setInstId(simSnapshot.instId);
                if (simSnapshot.tf && ["1m", "5m", "15m"].includes(simSnapshot.tf)) setTf(simSnapshot.tf as TF);
            } else {
                try {
                    const res = await fetch("/api/state", { cache: "no-store" });
                    const doc = await res.json();
                    if (doc?.sim) {
                        setSim(doc.sim);
                        setCandles(doc.candles || []);
                        if (doc.instId) setInstId(doc.instId);
                        if (doc.tf && ["1m", "5m", "15m"].includes(doc.tf)) setTf(doc.tf);
                    }
                } catch { }
            }
        })();
    }, []);

    // Перевірка instId → конект (ЛИШЕ при зміні інструмента/TF)
    useEffect(() => {
        let cancelled = false;

        (async () => {
            setStatus("checking"); setErr(null);
            const ok = await existsInstId(instId);
            if (cancelled) return;

            if (!ok) {
                setStatus("idle");
                setErr(`❌ ${instId} не знайдено для ${inferInstType(instId)}.`);
                return;
            }

            // Разовий reset при зміні інструмента/TF
            setCandles([]); setLast(null); setPackets(0);
            setSim({
                cashUSDT: 100, position: null, equityUSDT: 100, trades: [],
                ema12: undefined, ema26: undefined, lastClosedTs: undefined, pending: null,
            });
            lastBarTsRef.current = null;

            // Warmup історією (одноразово)

            try {
                const bar = tf; // "1m"|"5m"|"15m"
                const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${bar}&limit=${Math.max(150, settings.emaSlow * 6)}`;
                const res = await fetch(url, { cache: "no-store" });
                const json = await res.json();
                const rows: string[][] = Array.isArray(json.data) ? json.data : [];
                const warm = rows.slice().reverse().map(r => parseCandleRow(r)).filter(Boolean) as Candle[];
                setCandles(warm.slice(-settings.maxBars));
                if (warm.length) setLast(warm[warm.length - 1]);
            } catch (e) {
                console.warn("Warmup failed:", e);
            }



            connect();
        })();

        return () => {
            cancelled = true;
            if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
            if (wsRef.current) { try { wsRef.current.close(); } catch { } wsRef.current = null; }
        };
    }, [instId, tf, connect]);

    // EMA серії для графіка
    const { ema12Series, ema26Series } = useMemo(() => {
        const e12: number[] = []; const e26: number[] = [];
        let p12: number | undefined; let p26: number | undefined;
        for (const c of candles) {
            p12 = emaNext(p12, c.close, FAST);
            p26 = emaNext(p26, c.close, SLOW);
            e12.push(p12); e26.push(p26);
        }
        return { ema12Series: e12, ema26Series: e26 };
    }, [candles]);

    // Autosave у Zustand
    useEffect(() => {
        setSimSnapshot({
            sim, instId, tf, candles: candles.slice(-settings.maxBars),
            savedAt: new Date().toISOString(),
        });
    }, [sim, instId, tf, candles, setSimSnapshot]);

    // Autosave у Mongo (кожні 10с)
    useEffect(() => {
        const id = window.setInterval(() => {
            fetch("/api/state", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    _id: "sim",
                    instId, tf, sim,
                    candles: candles.slice(-settings.maxBars),
                    updatedAt: new Date().toISOString(),
                }),
            }).catch(console.error);
        }, 10_000);
        return () => clearInterval(id);
    }, [instId, tf, sim, candles]);

    // Відстеження нових угод → писати в Mongo
    const tradesRef = useRef<number>(0);
    useEffect(() => {
        if (sim.trades.length > tradesRef.current) {
            const newOnes = sim.trades.slice(tradesRef.current);
            tradesRef.current = sim.trades.length;
            newOnes.forEach((t) => saveTradeToDB({ ...t, instId, tf }));
        }
    }, [sim.trades, instId, tf]);

    const lastInfo = last
        ? `${dtFmt.format(new Date(last.ts))}  O:${nf2.format(last.open)}  H:${nf2.format(last.high)}  L:${nf2.format(last.low)}  C:${nf2.format(last.close)}  (${last.confirm === "1" ? "closed" : "live"})`
        : "—";

    const pnlOpen = useMemo(() => {
        if (!sim.position || !last) return 0;
        const gross = sim.position.qty * last.close;
        const net = gross * (1 - FEE_RATE);
        const cost = sim.position.qty * sim.position.entry;
        return net - cost;
    }, [sim.position, last]);

    return (
        <div className="rounded-2xl bg-white/70 backdrop-blur p-4 my-8 shadow-soft">
            {/* статус / інструмент / TF */}
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm px-2 py-1 rounded bg-slate-900/80 text-white">WS: {status}</span>
                {err && <span className="text-sm px-2 py-1 rounded bg-rose-600/80 text-white">ERR: {err}</span>}
                <span className="text-sm px-2 py-1 rounded bg-slate-200">Packets: {packets}</span>

                <label className="ml-auto text-sm text-slate-700">
                    Інструмент:&nbsp;
                    <select value={instId} onChange={(e) => setInstId(e.target.value)}
                        className="rounded border border-slate-300 bg-white px-2 py-1">
                        {/* SPOT */}
                        <option>BTC-USDT</option>
                        <option>ETH-USDT</option>
                        <option>SOL-USDT</option>
                        {/* SWAP (USDT) */}
                        <option>BTC-USDT-SWAP</option>
                        <option>ETH-USDT-SWAP</option>
                        {/* SWAP (USD) */}
                        <option>BTC-USD-SWAP</option>
                        <option>ETH-USD-SWAP</option>
                    </select>
                </label>

                <label className="text-sm text-slate-700">
                    TF:&nbsp;
                    <select value={tf} onChange={(e) => setTf(e.target.value as TF)}
                        className="rounded border border-slate-300 bg-white px-2 py-1">
                        <option value="1m">1m</option>
                        <option value="5m">5m</option>
                        <option value="15m">15m</option>
                    </select>
                </label>
            </div>

            {/* графік з EMA та маркерами угод */}
            <div className="mt-4">
                <CandlesChart
                    candles={candles}
                    height={220}
                    maxBars={140}
                    ema12={ema12Series}
                    ema26={ema26Series}
                    trades={sim.trades}
                />
            </div>

            {/* інфо про останню свічку */}
            <div className="mt-3 rounded-lg bg-white/60 p-3 text-sm text-slate-800">
                <div className="text-slate-500 text-xs mb-1">Остання свічка:</div>
                <div className="font-mono">{lastInfo}</div>
            </div>

            {/* симуляція */}
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="rounded-lg bg-white/70 p-3">
                    <div className="text-xs text-slate-500">Кеш USDT</div>
                    <div className="mt-1 text-lg font-semibold">{nf4.format(sim.cashUSDT)}</div>
                </div>
                <div className="rounded-lg bg-white/70 p-3">
                    <div className="text-xs text-slate-500">Еквіті USDT</div>
                    <div className="mt-1 text-lg font-semibold">{nf4.format(sim.equityUSDT)}</div>
                </div>
                <div className="rounded-lg bg-white/70 p-3">
                    <div className="text-xs text-slate-500">Відкрита позиція</div>
                    <div className="mt-1 text-sm">
                        {sim.position ? (
                            <>
                                qty: <span className="font-mono">{nf6(sim.position.qty)}</span>&nbsp; @{" "}
                                <span className="font-mono">{nf2.format(sim.position.entry)}</span>
                                {last && (
                                    <>
                                        <br />
                                        PnL: <span className={pnlOpen >= 0 ? "text-emerald-600" : "text-rose-600"}>
                                            {nf4.format(pnlOpen)} USDT
                                        </span>
                                    </>
                                )}
                            </>
                        ) : "—"}
                    </div>
                </div>
            </div>

            {/* EMA/fee */}
            <div className="mt-3 rounded-lg bg-white/60 p-3 text-xs text-slate-700">
                EMA12: <span className="font-mono">{sim.ema12 ? nf2.format(sim.ema12) : "—"}</span>&nbsp; |&nbsp;
                EMA26: <span className="font-mono">{sim.ema26 ? nf2.format(sim.ema26) : "—"}</span>&nbsp; |&nbsp;
                Fee: <span className="font-mono">{(FEE_RATE * 100).toFixed(2)}%</span>&nbsp; |&nbsp;
                Slippage: <span className="font-mono">{(SLIPPAGE * 100).toFixed(3)}%</span>
            </div>

            {/* історія угод */}
            <div className="mt-4 rounded-lg bg-white/70 p-3">
                <div className="text-sm font-semibold mb-2">Історія угод (останні 10)</div>
                {sim.trades.length === 0 ? (
                    <div className="text-slate-500 text-sm">Поки що немає угод…</div>
                ) : (
                    <table className="w-full text-sm">
                        <thead className="text-left text-slate-500">
                            <tr>
                                <th className="py-1">Час</th>
                                <th className="py-1">Сторона</th>
                                <th className="py-1">Ціна</th>
                                <th className="py-1">К-сть</th>
                                <th className="py-1">PnL</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sim.trades.slice(-10).reverse().map((t, idx) => (
                                <tr key={idx} className="border-t border-slate-200/60">
                                    <td className="py-1">{dtFmt.format(new Date(t.ts))}</td>
                                    <td className="py-1">{t.side}</td>
                                    <td className="py-1 font-mono">{nf2.format(t.price)}</td>
                                    <td className="py-1 font-mono">{nf6(t.qty)}</td>
                                    <td className="py-1 font-mono">
                                        {t.side === "SELL"
                                            ? <span className={t.pnlUSDT! >= 0 ? "text-emerald-600" : "text-rose-600"}>
                                                {nf4.format(t.pnlUSDT!)}
                                            </span>
                                            : "—"}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}

function nf6(x: number) {
    return (Math.round(x * 1e6) / 1e6).toFixed(6);
}

