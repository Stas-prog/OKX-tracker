// src/components/Bot.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CandlesChart, { Candle as ChartCandle } from "@/app/components/CandlesChart";

/* ================= Types & consts ================= */
type InstType = "SPOT" | "SWAP" | "FUTURES";
type OkxArg = { channel: string; instId: string };
type OkxCandleMsg = { arg: OkxArg; data: string[][] };
type OkxEvent =
    | { event: "subscribe" | "unsubscribe" | "error"; code?: string; msg?: string; arg?: OkxArg }
    | Record<string, unknown>;

const WS_URL = "wss://ws.okx.com:8443/ws/v5/business";
const CHANNEL = "candle1m";

type Candle = ChartCandle & { confirm?: "0" | "1" }; // додаємо прапорець закриття

const nf2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });
const nf4 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });
const dtFmt = new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

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

// OKX row: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
function parseCandleRow(row: string[]): Candle | null {
    try {
        const [ts, o, h, l, c, vol, _vccy, _vccyQ, confirm] = row;
        return {
            ts: Number(ts),
            open: Number(o),
            high: Number(h),
            low: Number(l),
            close: Number(c),
            vol: Number(vol),
            confirm: (confirm === "1" ? "1" : "0"),
        };
    } catch {
        return null;
    }
}

/* ================= Trading simulation ================= */
// Простий симулятор на EMA-кросі (тільки лонг, усім банком)
type Position = {
    entry: number;
    qty: number;       // у базовій валюті (BTC)
    entryTs: number;
};

type Trade = {
    side: "BUY" | "SELL";
    price: number;
    qty: number;
    ts: number;
    pnlUSDT?: number;  // для SELL
};

type SimState = {
    cashUSDT: number;      // вільний кеш
    position: Position | null;
    equityUSDT: number;    // кеш + (позиція по mark price)
    trades: Trade[];
    ema12?: number;
    ema26?: number;
    lastClosedTs?: number; // щоб не обробляти ту саму свічку двічі
};

// EMA α = 2/(n+1)
function emaNext(prev: number | undefined, price: number, period: number): number {
    const alpha = 2 / (period + 1);
    return prev === undefined ? price : prev + alpha * (price - prev);
}

function computeEquity(state: SimState, mark: number): number {
    if (!state.position) return state.cashUSDT;
    return state.cashUSDT + state.position.qty * mark;
}

function tryEnter(state: SimState, price: number, ts: number): SimState {
    if (state.position) return state; // вже в позиції
    if (state.cashUSDT <= 0) return state;
    const qty = state.cashUSDT / price;
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
    const pnl = qty * (price - entry);
    const sell: Trade = { side: "SELL", price, qty, ts, pnlUSDT: pnl };
    const cash = state.cashUSDT + qty * price;
    const next: SimState = {
        ...state,
        cashUSDT: cash,
        position: null,
        trades: [...state.trades, sell],
    };
    next.equityUSDT = computeEquity(next, price);
    return next;
}

/* ================= Component ================= */
export default function Bot() {
    const [instId, setInstId] = useState<string>("BTC-USDT");
    const [status, setStatus] = useState<"idle" | "checking" | "connecting" | "open" | "closed" | "error">("idle");
    const [err, setErr] = useState<string | null>(null);

    const [last, setLast] = useState<Candle | null>(null);
    const [candles, setCandles] = useState<Candle[]>([]);
    const [packets, setPackets] = useState<number>(0);

    // Симулятор
    const [sim, setSim] = useState<SimState>(() => ({
        cashUSDT: 100,
        position: null,
        equityUSDT: 100,
        trades: [],
        ema12: undefined,
        ema26: undefined,
        lastClosedTs: undefined,
    }));

    // Стратегія
    const TAKE_PROFIT = 0.04; // +4%
    const STOP_LOSS = 0.02; // -2%
    const FAST = 12, SLOW = 26;

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<number | null>(null);

    const arg: OkxArg = useMemo(() => ({ channel: CHANNEL, instId }), [instId]);

    const subscribeCandles = useCallback(() => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ op: "subscribe", args: [arg] }));
    }, [arg]);

    const unsubscribeCandles = useCallback((prev: OkxArg) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({ op: "unsubscribe", args: [prev] }));
    }, []);

    // Основна логіка оновлення симулятора на закритій свічці
    const onClosedCandle = useCallback((c: Candle) => {
        setSim((prev) => {
            // захист від повторної обробки тієї ж свічки
            if (prev.lastClosedTs === c.ts) return prev;

            // оновлюємо EMA на close
            const ema12 = emaNext(prev.ema12, c.close, FAST);
            const ema26 = emaNext(prev.ema26, c.close, SLOW);

            let next: SimState = {
                ...prev,
                ema12,
                ema26,
                lastClosedTs: c.ts,
            };

            // сигнал кросу
            const wasAbove = prev.ema12 !== undefined && prev.ema26 !== undefined && prev.ema12 > prev.ema26;
            const isAbove = ema12 > ema26;

            // якщо у позиції — стоп/тейк
            if (next.position) {
                const pnlPct = (c.close - next.position.entry) / next.position.entry;
                if (pnlPct >= TAKE_PROFIT || pnlPct <= -STOP_LOSS) {
                    next = tryExit(next, c.close, c.ts);
                }
            }

            // вхід/вихід за кросом
            if (!next.position && wasAbove === false && isAbove === true) {
                // перетин вгору → купуємо
                next = tryEnter(next, c.close, c.ts);
            } else if (next.position && wasAbove === true && isAbove === false) {
                // перетин вниз → продаємо
                next = tryExit(next, c.close, c.ts);
            }

            // оновлюємо equity по останній ціні
            next.equityUSDT = computeEquity(next, c.close);
            return next;
        });
    }, []);

    // Підключення WS
    const connect = useCallback(() => {
        if (wsRef.current) {
            try { wsRef.current.close(); } catch { }
            wsRef.current = null;
        }
        setStatus("connecting");
        setErr(null);

        const ws = new WebSocket(WS_URL);
        wsRef.current = ws;

        ws.addEventListener("open", () => {
            setStatus("open");
            subscribeCandles();
        });

        ws.addEventListener("message", (evt) => {
            try {
                const parsed = JSON.parse(String(evt.data)) as OkxEvent | OkxCandleMsg;

                if ("event" in parsed && parsed.event === "error") {
                    const msg = `OKX WS error: ${parsed.code ?? ""} ${parsed.msg ?? ""}`.trim();
                    setErr(msg || "WS error");
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
                        if (prev.length > 0 && prev[prev.length - 1].ts === candle.ts) {
                            const next = prev.slice(0, -1);
                            next.push(candle);
                            return next;
                        }
                        const next = [...prev, candle];
                        if (next.length > 240) next.shift();
                        return next;
                    });

                    // симуляцію робимо тільки на закритій свічці
                    if (candle.confirm === "1") {
                        onClosedCandle(candle);
                    } else {
                        // якщо свічка ще відкрита — все одно оновимо equity по поточній ціні
                        setSim((prev) => ({ ...prev, equityUSDT: computeEquity(prev, candle.close) }));
                    }
                }
            } catch (e) {
                setErr(`Parse error: ${(e as Error).message}`);
            }
        });

        ws.addEventListener("error", () => {
            setStatus("error");
            setErr("WebSocket error");
        });

        ws.addEventListener("close", () => {
            setStatus("closed");
            if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
            reconnectTimer.current = window.setTimeout(() => connect(), 2000) as unknown as number;
        });
    }, [subscribeCandles, onClosedCandle]);

    // Перевірка instId → конект
    useEffect(() => {
        let cancelled = false;

        (async () => {
            setStatus("checking");
            setErr(null);

            const ok = await existsInstId(instId);
            if (cancelled) return;

            if (!ok) {
                setStatus("idle");
                setErr(
                    `❌ Інструмент ${instId} не знайдено для ${inferInstType(instId)}.
Спробуй: BTC-USDT (SPOT), BTC-USDT-SWAP (USDT SWAP) або BTC-USD-SWAP (USD SWAP)`
                );
                return;
            }

            // починаємо «з нуля» при зміні інструменту
            setCandles([]);
            setLast(null);
            setPackets(0);
            setSim({
                cashUSDT: 100,
                position: null,
                equityUSDT: 100,
                trades: [],
                ema12: undefined,
                ema26: undefined,
                lastClosedTs: undefined,
            });

            connect();
        })();

        return () => {
            cancelled = true;
            if (reconnectTimer.current) window.clearTimeout(reconnectTimer.current);
            if (wsRef.current) {
                try { wsRef.current.close(); } catch { }
                wsRef.current = null;
            }
        };
    }, [instId, connect]);

    // Швидке перемикання без реконекту — відписка/підписка
    const prevArgRef = useRef<OkxArg | null>(null);
    useEffect(() => {
        const prev = prevArgRef.current;
        if (prev && (prev.instId !== arg.instId || prev.channel !== arg.channel)) {
            unsubscribeCandles(prev);
            setCandles([]);
            setLast(null);
            setPackets(0);
            setSim({
                cashUSDT: 100,
                position: null,
                equityUSDT: 100,
                trades: [],
                ema12: undefined,
                ema26: undefined,
                lastClosedTs: undefined,
            });
            subscribeCandles();
        }
        prevArgRef.current = arg;
    }, [arg, subscribeCandles, unsubscribeCandles]);

    const lastInfo = last
        ? `${dtFmt.format(new Date(last.ts))}  O:${nf2.format(last.open)}  H:${nf2.format(last.high)}  L:${nf2.format(last.low)}  C:${nf2.format(last.close)}  (${last.confirm === "1" ? "closed" : "live"})`
        : "—";

    const pnlOpen = useMemo(() => {
        if (!sim.position || !last) return 0;
        return sim.position.qty * (last.close - sim.position.entry);
    }, [sim.position, last]);

    /* ================= Render ================= */
    return (
        <div className="rounded-2xl bg-white/70 backdrop-blur p-4 shadow-soft">
            {/* статусна панель */}
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
                        {/* SWAP (USDT-margined) */}
                        <option>BTC-USDT-SWAP</option>
                        <option>ETH-USDT-SWAP</option>
                        {/* SWAP (USD-margined) */}
                        <option>BTC-USD-SWAP</option>
                        <option>ETH-USD-SWAP</option>
                    </select>
                </label>
            </div>

            {/* графік */}
            <div className="mt-4">
                <CandlesChart candles={candles} height={220} maxBars={140} />
            </div>

            {/* інфо про останню свічку */}
            <div className="mt-3 rounded-lg bg-white/60 p-3 text-sm text-slate-800">
                <div className="text-slate-500 text-xs mb-1">Остання свічка:</div>
                <div className="font-mono">{lastInfo}</div>
            </div>

            {/* блок симуляції */}
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
                        ) : (
                            "—"
                        )}
                    </div>
                </div>
            </div>

            {/* EMA info */}
            <div className="mt-3 rounded-lg bg-white/60 p-3 text-xs text-slate-700">
                EMA12: <span className="font-mono">{sim.ema12 ? nf2.format(sim.ema12) : "—"}</span>&nbsp; |&nbsp;
                EMA26: <span className="font-mono">{sim.ema26 ? nf2.format(sim.ema26) : "—"}</span>
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

// допоміжний форматер з 6 знаками (для qty у BTC)
function nf6(x: number) {
    return (Math.round(x * 1e6) / 1e6).toFixed(6);
}
