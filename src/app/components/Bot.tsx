"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CandlesChart, { Candle as ChartCandle, Trade as ChartTrade } from "@/app/components/CandlesChart";
import { useTraderStore } from "@/store/trader";
import { getClientId } from "@/lib/clientId";
import { fetchTrades } from "@/lib/api";
import { nf2, nf4, nf6, dtFmt } from "@/lib/nf";
import SettingsPanel from "@/app/components/SettingsPanel";
import { OkxWs } from "@/lib/okxWs";

/* ================= Types & consts ================= */
type InstType = "SPOT" | "SWAP" | "FUTURES";
type OkxArg = { channel: string; instId: string };
type OkxCandleMsg = { arg: OkxArg; data: string[][] };

const TF_MAP = { "1m": "candle1m", "5m": "candle5m", "15m": "candle15m" } as const;
type TF = keyof typeof TF_MAP;

type Candle = ChartCandle & { confirm?: "0" | "1" };

type Settings = {
    emaFast: number;
    emaSlow: number;
    takeProfit: number;
    stopLoss: number;
    feeRate: number;
    slippage: number;
    maxBars: number;
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

function mergeTrades(local: ChartTrade[], fromDb: any[]): ChartTrade[] {
    const arr: any[] = Array.isArray(fromDb) ? fromDb : [];
    const mapped: ChartTrade[] = arr.map((t) => ({
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
        if (!seen.has(k)) {
            seen.add(k);
            out.push(t);
        }
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

    emaFast?: number;
    emaSlow?: number;

    lastClosedTs?: number;
    pending?: PendingOrder;

    lastTradeTs?: number;
    cooldownUntilTs?: number;
    enteredAtTs?: number;
};

const DEFAULT_CASH = 100;
const COOLDOWN_BARS = 2;

/* ================= Component ================= */
export default function Bot() {
    // ---- UI/State
    const [instId, setInstId] = useState<string>("BTC-USDT");
    const [tf, setTf] = useState<TF>("1m");

    const [status, setStatus] = useState<"idle" | "checking" | "connecting" | "open" | "closed" | "error">("idle");
    const [err, setErr] = useState<string | null>(null);

    const [last, setLast] = useState<Candle | null>(null);
    const [candles, setCandles] = useState<Candle[]>([]);
    const [packets, setPackets] = useState<number>(0);

    const [settings, setSettings] = useState<Settings>({
        emaFast: 8,
        emaSlow: 21,
        takeProfit: 0.04,
        stopLoss: 0.02,
        feeRate: 0.001,
        slippage: 0.0005,
        maxBars: 400,
    });

    const [sim, setSim] = useState<SimState>(() => ({
        cashUSDT: DEFAULT_CASH,
        position: null,
        equityUSDT: DEFAULT_CASH,
        trades: [],
        emaFast: undefined,
        emaSlow: undefined,
        lastClosedTs: undefined,
        pending: null,
        lastTradeTs: undefined,
        cooldownUntilTs: undefined,
        enteredAtTs: undefined,
    }));

    const [isLeader, setIsLeader] = useState(false);
    const clientIdRef = useRef<string>("");

    const settingsRef = useRef(settings);
    useEffect(() => {
        settingsRef.current = settings;
    }, [settings]);

    const FAST = settings.emaFast;
    const SLOW = settings.emaSlow;
    const TAKE_PROFIT = settings.takeProfit;
    const STOP_LOSS = settings.stopLoss;
    const FEE_RATE = settings.feeRate;
    const SLIPPAGE = settings.slippage;
    const MAX_BARS = settings.maxBars;

    // Zustand persist
    const { simSnapshot, setSimSnapshot } = useTraderStore();

    // clientId + settings
    useEffect(() => {
        clientIdRef.current = getClientId();
        (async () => {
            try {
                const r = await fetch("/api/settings", { cache: "no-store" });
                const s = await r.json();
                setSettings((prev) => ({ ...prev, ...s }));
            } catch { }
        })();
    }, []);

    // Лідерська оренда
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
        return () => {
            stop = true;
            clearInterval(id);
        };
    }, []);

    // refs
    const simRef = useRef(sim);
    useEffect(() => {
        simRef.current = sim;
    }, [sim]);
    const lastBarTsRef = useRef<number | null>(null);

    // ===== onClosedCandle (EMA, сигнали, стоп/тейк) =====
    const onClosedCandle = useCallback(
        (c: Candle) => {
            setSim((prev) => {
                if (prev.lastClosedTs === c.ts) return prev;

                const emaFast = emaNext(prev.emaFast, c.close, settingsRef.current.emaFast);
                const emaSlow = emaNext(prev.emaSlow, c.close, settingsRef.current.emaSlow);

                let next: SimState = { ...prev, emaFast, emaSlow, lastClosedTs: c.ts };

                // стоп/тейк
                if (next.position) {
                    const pnlPct = (c.close - next.position.entry) / next.position.entry;
                    if (pnlPct >= settingsRef.current.takeProfit || pnlPct <= -settingsRef.current.stopLoss) {
                        next = tryExit(next, c.close, c.ts);
                        next.cooldownUntilTs = c.ts + COOLDOWN_BARS * 60 * 1000;
                        next.lastTradeTs = c.ts;
                    }
                }

                // перетин ліній → pending (лише лідер)
                if (isLeader) {
                    const wasAbove =
                        prev.emaFast !== undefined && prev.emaSlow !== undefined && prev.emaFast > prev.emaSlow;
                    const isAbove = emaFast > emaSlow;
                    const inCooldown = !!prev.cooldownUntilTs && c.ts < prev.cooldownUntilTs;

                    if (!inCooldown) {
                        if (!next.position && wasAbove === false && isAbove === true) {
                            next.pending = { side: "BUY", forTs: c.ts };
                        } else if (next.position && wasAbove === true && isAbove === false) {
                            next.pending = { side: "SELL", forTs: c.ts };
                        }
                    }
                }

                next.equityUSDT = computeEquity(next, c.close);
                return next;
            });
        },
        [isLeader]
    );

    // ===== Helpers =====
    function computeEquity(state: SimState, mark: number): number {
        if (!state.position) return state.cashUSDT;
        return state.cashUSDT + state.position.qty * mark;
    }

    async function saveTradeToDB(t: Trade & { instId: string; tf: string }) {
        await fetch("/api/trades", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ ...t, createdAt: new Date().toISOString() }),
        }).catch(() => { });
    }

    function tryEnter(state: SimState, price: number, ts: number): SimState {
        if (state.position || state.cashUSDT <= 0) return state;
        const qty = (state.cashUSDT * (1 - settingsRef.current.feeRate)) / price;
        const pos: Position = { entry: price, qty, entryTs: ts };
        const buy: Trade = { side: "BUY", price, qty, ts };
        const next: SimState = {
            ...state,
            cashUSDT: 0,
            position: pos,
            trades: [...state.trades, buy],
            lastTradeTs: ts,
            enteredAtTs: ts,
        };
        next.equityUSDT = computeEquity(next, price);
        return next;
    }

    function tryExit(state: SimState, price: number, ts: number): SimState {
        if (!state.position) return state;
        const { qty, entry } = state.position;
        const grossProceeds = qty * price;
        const netProceeds = grossProceeds * (1 - settingsRef.current.feeRate);
        const cost = qty * entry;
        const pnl = netProceeds - cost;

        const sell: Trade = { side: "SELL", price, qty, ts, pnlUSDT: pnl };
        const cash = state.cashUSDT + netProceeds;
        const next: SimState = {
            ...state,
            cashUSDT: cash,
            position: null,
            trades: [...state.trades, sell],
            lastTradeTs: ts,
            cooldownUntilTs: ts + COOLDOWN_BARS * 60 * 1000,
            enteredAtTs: undefined,
        };
        next.equityUSDT = computeEquity(next, price);
        return next;
    }

    function execAtOpen(next: SimState, side: "BUY" | "SELL", open: number, ts: number): SimState {
        const px =
            side === "BUY" ? open * (1 + settingsRef.current.slippage) : open * (1 - settingsRef.current.slippage);
        return side === "BUY" ? tryEnter(next, px, ts) : tryExit(next, px, ts);
    }

    /* ================== WS via OkxWs ================== */
    const wsClientRef = useRef<OkxWs | null>(null);

    // Відновлення з local/Mongo
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

    // Пул стану/трейдів (не лідер)
    useEffect(() => {
        if (isLeader) return;
        let stop = false;

        const id = setInterval(async () => {
            try {
                const rState = await fetch("/api/state", { cache: "no-store" });
                const doc = await rState.json();
                if (!stop && doc?.sim) {
                    setSim(doc.sim);
                    setCandles(doc.candles || []);
                    if (doc.instId) setInstId(doc.instId);
                    if (doc.tf && ["1m", "5m", "15m"].includes(doc.tf)) setTf(doc.tf);
                }
            } catch { }

            try {
                const rows = await fetchTrades({ limit: 2000, order: "asc" });
                setSim((prev) => ({ ...prev, trades: mergeTrades(prev.trades, rows) }));
            } catch { }
        }, 20_000);

        return () => {
            stop = true;
            clearInterval(id);
        };
    }, [isLeader]);

    // Додатковий pull нових трейдів (не лідер)
    useEffect(() => {
        if (isLeader) return;
        let stop = false;

        const pull = async () => {
            try {
                const sinceIso = new Date(Date.now() - 15 * 60 * 1000).toISOString();
                const rows = await fetchTrades({ since: sinceIso, order: "asc", limit: 2000 });
                if (!stop && rows?.length) {
                    setSim((prev) => ({ ...prev, trades: mergeTrades(prev.trades, rows) }));
                }
            } catch { }
        };

        pull();
        const id = setInterval(pull, 20_000);
        return () => {
            stop = true;
            clearInterval(id);
        };
    }, [isLeader]);

    // Конект WS, warmup, підписка на свічки
    const connect = useCallback(() => {
        wsClientRef.current?.close();
        wsClientRef.current = null;

        setStatus("checking");
        setErr(null);

        (async () => {
            const ok = await existsInstId(instId);
            if (!ok) {
                setStatus("idle");
                setErr(`❌ ${instId} не знайдено для ${inferInstType(instId)}.`);
                return;
            }

            // reset
            setCandles([]);
            setLast(null);
            setPackets(0);
            setSim({
                cashUSDT: DEFAULT_CASH,
                position: null,
                equityUSDT: DEFAULT_CASH,
                trades: [],
                emaFast: undefined,
                emaSlow: undefined,
                lastClosedTs: undefined,
                pending: null,
                lastTradeTs: undefined,
                cooldownUntilTs: undefined,
                enteredAtTs: undefined,
            });
            lastBarTsRef.current = null;

            // warmup
            try {
                const url = `https://www.okx.com/api/v5/market/candles?instId=${instId}&bar=${tf}&limit=${Math.max(
                    150,
                    settings.emaSlow * 6
                )}`;
                const res = await fetch(url, { cache: "no-store" });
                const json = await res.json();
                const rows: string[][] = Array.isArray(json.data) ? json.data : [];
                const warm = rows
                    .slice()
                    .reverse()
                    .map((r) => parseCandleRow(r))
                    .filter(Boolean) as Candle[];
                setCandles(warm.slice(-settings.maxBars));
                if (warm.length) setLast(warm[warm.length - 1]);
            } catch (e) {
                console.warn("Warmup failed:", e);
            }

            // WS
            setStatus("connecting");
            const client = new OkxWs({
                url: "wss://ws.okx.com:8443/ws/v5/business",
                debug: false,
                onErrorText: (txt) => setErr(txt),
                onCandle: (json: OkxCandleMsg) => {
                    const rows = json.data;
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

                    // виконання pending на відкритті нової свічки
                    const isNewBar = lastBarTsRef.current !== candle.ts;
                    if (isNewBar && isLeader && simRef.current?.pending) {
                        const p = simRef.current.pending!;
                        setSim((prev) => {
                            let after = execAtOpen(prev, p.side, candle.open, candle.ts);
                            after.pending = null;
                            after.equityUSDT = computeEquity(after, candle.close);
                            after.lastTradeTs = candle.ts;
                            after.enteredAtTs = p.side === "BUY" ? candle.ts : undefined;
                            return after;
                        });
                    }

                    if (candle.confirm === "1") onClosedCandle(candle);
                    else setSim((prev) => ({ ...prev, equityUSDT: computeEquity(prev, candle.close) }));

                    lastBarTsRef.current = candle.ts;
                },
                onAny: (json) => {
                    if ((json as any)?.event === "subscribe") setStatus("open");
                    if ((json as any)?.event === "error") setStatus("error");
                },
            });

            wsClientRef.current = client;
            client.connect();
            client.subscribe([{ channel: TF_MAP[tf], instId }]);
        })();
    }, [instId, tf, settings.emaSlow, settings.maxBars, isLeader, onClosedCandle]);

    // React на зміну instId/tf → connect
    useEffect(() => {
        connect();
        return () => {
            wsClientRef.current?.close();
            wsClientRef.current = null;
        };
    }, [connect]);

    // Autosave → Zustand
    useEffect(() => {
        setSimSnapshot({
            sim,
            instId,
            tf,
            candles: candles.slice(-settings.maxBars),
            savedAt: new Date().toISOString(),
        });
    }, [sim, instId, tf, candles, settings.maxBars, setSimSnapshot]);

    // Autosave → Mongo (лише лідер)
    useEffect(() => {
        if (!isLeader) return;
        const id = window.setInterval(() => {
            fetch("/api/state", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({
                    _id: "sim",
                    instId,
                    tf,
                    sim,
                    candles: candles.slice(-settings.maxBars),
                    updatedAt: new Date().toISOString(),
                }),
            }).catch(console.error);
        }, 10_000);
        return () => clearInterval(id);
    }, [isLeader, instId, tf, sim, candles, settings.maxBars]);

    // Нові угоди → Mongo (лише лідер)
    const tradesRef = useRef<number>(0);
    useEffect(() => {
        if (!isLeader) return;
        if (sim.trades.length > tradesRef.current) {
            const newOnes = sim.trades.slice(tradesRef.current);
            tradesRef.current = sim.trades.length;
            newOnes.forEach((t) => saveTradeToDB({ ...t, instId, tf }).catch(() => { }));
        }
    }, [sim.trades, instId, tf, isLeader]);

    // Online/offline — відновити конект
    useEffect(() => {
        const onOnline = () => connect();
        const onOffline = () => wsClientRef.current?.close();
        window.addEventListener("online", onOnline);
        window.addEventListener("offline", onOffline);
        return () => {
            window.removeEventListener("online", onOnline);
            window.removeEventListener("offline", onOffline);
        };
    }, [connect]);

    // EMA серії для графіка
    const { emaFastSeries, emaSlowSeries } = useMemo(() => {
        const eF: number[] = [];
        const eS: number[] = [];
        let pF: number | undefined;
        let pS: number | undefined;
        for (const c of candles) {
            pF = emaNext(pF, c.close, FAST);
            pS = emaNext(pS, c.close, SLOW);
            eF.push(pF);
            eS.push(pS);
        }
        return { emaFastSeries: eF, emaSlowSeries: eS };
    }, [candles, FAST, SLOW]);

    const lastInfo = last
        ? `${dtFmt.format(new Date(last.ts))}  O:${nf2.format(last.open)}  H:${nf2.format(
            last.high
        )}  L:${nf2.format(last.low)}  C:${nf2.format(last.close)}  (${last.confirm === "1" ? "closed" : "live"})`
        : "—";

    const pnlOpen = useMemo(() => {
        if (!sim.position || !last) return 0;
        const gross = sim.position.qty * last.close;
        const net = gross * (1 - FEE_RATE);
        const cost = sim.position.qty * sim.position.entry;
        return net - cost;
    }, [sim.position, last, FEE_RATE]);

    return (
        <div className="rounded-2xl bg-white/70 backdrop-blur p-4 my-8 shadow-soft">
            {/* статус / інструмент / TF */}
            <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm px-2 py-1 rounded bg-slate-900/80 text-white">WS: {status}</span>
                {err && <span className="text-sm px-2 py-1 rounded bg-rose-600/80 text-white">ERR: {err}</span>}
                <span className="text-sm px-2 py-1 rounded bg-slate-200">Packets: {packets}</span>

                <label className="ml-auto text-sm text-slate-700">
                    Інструмент:&nbsp;
                    <select
                        value={instId}
                        onChange={(e) => setInstId(e.target.value)}
                        className="rounded border border-slate-300 bg-white px-2 py-1"
                    >
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
                    <select
                        value={tf}
                        onChange={(e) => setTf(e.target.value as TF)}
                        className="rounded border border-slate-300 bg-white px-2 py-1"
                    >
                        <option value="1m">1m</option>
                        <option value="5m">5m</option>
                        <option value="15m">15m</option>
                    </select>
                </label>
            </div>

            {/* live-настройки */}
            <div className="mt-3">
                <SettingsPanel
                    value={settings}
                    onChange={(s) => setSettings(s)}
                />
            </div>


            {/* графік */}
            <div className="mt-4">
                <CandlesChart
                    candles={candles}
                    height={220}
                    maxBars={140}
                    ema12={emaFastSeries}
                    ema26={emaSlowSeries}
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
                                        PnL:{" "}
                                        <span className={pnlOpen >= 0 ? "text-emerald-600" : "text-rose-600"}>
                                            {nf4.format(pnlOpen)} USDT
                                        </span>
                                    </>
                                )}
                            </>
                        ) : (
                            "—"
                        )}
                    </div>
                </div>
            </div>

            {/* EMA/fee */}
            <div className="mt-3 rounded-lg bg-white/60 p-3 text-xs text-slate-700">
                EMA{FAST}: <span className="font-mono">{sim.emaFast ? nf2.format(sim.emaFast) : "—"}</span>&nbsp; |&nbsp; EMA
                {SLOW}: <span className="font-mono">{sim.emaSlow ? nf2.format(sim.emaSlow) : "—"}</span>&nbsp; |&nbsp; Fee:{" "}
                <span className="font-mono">{(FEE_RATE * 100).toFixed(2)}%</span>&nbsp; |&nbsp; Slippage:{" "}
                <span className="font-mono">{(SLIPPAGE * 100).toFixed(3)}%</span>
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
                            {sim.trades
                                .slice(-10)
                                .reverse()
                                .map((t, idx) => (
                                    <tr key={idx} className="border-t border-slate-200/60">
                                        <td className="py-1">{dtFmt.format(new Date(t.ts))}</td>
                                        <td className="py-1">{t.side}</td>
                                        <td className="py-1 font-mono">{nf2.format(t.price)}</td>
                                        <td className="py-1 font-mono">{nf6(t.qty)}</td>
                                        <td className="py-1 font-mono">
                                            {t.side === "SELL" ? (
                                                <span className={t.pnlUSDT! >= 0 ? "text-emerald-600" : "text-rose-600"}>
                                                    {nf4.format(t.pnlUSDT!)}
                                                </span>
                                            ) : (
                                                "—"
                                            )}
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
