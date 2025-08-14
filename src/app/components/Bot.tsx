// src/components/Bot.tsx
"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CandlesChart, { Candle as ChartCandle } from "@/app/components/CandlesChart";

// ===== Типи / константи =====
type InstType = "SPOT" | "SWAP" | "FUTURES";
type OkxArg = { channel: string; instId: string };
type OkxCandleMsg = { arg: OkxArg; data: string[][] };
type OkxEvent =
    | { event: "subscribe" | "unsubscribe" | "error"; code?: string; msg?: string; arg?: OkxArg }
    | Record<string, unknown>;

const WS_URL = "wss://ws.okx.com:8443/ws/v5/business";
const CHANNEL = "candle1m";

type Candle = ChartCandle; // { ts, open, high, low, close, vol }

const nf2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });
const dtFmt = new Intl.DateTimeFormat("uk-UA", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

// ===== Утиліти =====
function inferInstType(id: string): InstType {
    if (id.endsWith("-SWAP")) return "SWAP";
    if (/.*-\d{6}$/.test(id)) return "FUTURES"; // напр. BTC-USD-240927
    return "SPOT";
}

async function existsInstId(id: string) {
    const instType = inferInstType(id);
    const url = `https://www.okx.com/api/v5/public/instruments?instType=${instType}`;
    try {
        const res = await fetch(url, { cache: "no-store" });
        const json = await res.json();
        return Array.isArray(json.data) && json.data.some((i: any) => i.instId === id);
    } catch (err) {
        console.error("REST check failed:", err);
        return false;
    }
}

function parseCandleRow(row: string[]): Candle | null {
    // [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
    try {
        const [ts, o, h, l, c, vol] = row;
        return {
            ts: Number(ts),
            open: Number(o),
            high: Number(h),
            low: Number(l),
            close: Number(c),
            vol: Number(vol),
        };
    } catch {
        return null;
    }
}

// ===== Компонент =====
export default function Bot() {
    const [instId, setInstId] = useState<string>("BTC-USDT");
    const [status, setStatus] = useState<"idle" | "checking" | "connecting" | "open" | "closed" | "error">("idle");
    const [err, setErr] = useState<string | null>(null);

    const [last, setLast] = useState<Candle | null>(null);
    const [candles, setCandles] = useState<Candle[]>([]);
    const [packets, setPackets] = useState<number>(0);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectTimer = useRef<number | null>(null);

    const arg: OkxArg = useMemo(() => ({ channel: CHANNEL, instId }), [instId]);

    // Відписка / підписка
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

    // Швидкий тест через tickers (саніті-пінг того ж instId)
    // const probeTickers = useCallback(() => {
    //     const ws = wsRef.current;
    //     if (!ws || ws.readyState !== WebSocket.OPEN) return;
    //     const payload = { op: "subscribe", args: [{ channel: "tickers", instId }] };
    //     ws.send(JSON.stringify(payload));
    //     window.setTimeout(() => {
    //         ws.send(JSON.stringify({ op: "unsubscribe", args: [{ channel: "tickers", instId }] }));
    //     }, 1000);
    // }, [instId]);

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
            // probeTickers();
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

                // Дані свічок
                if ("arg" in parsed && "data" in parsed && Array.isArray(parsed.data)) {
                    const rows = parsed.data as string[][];
                    const row = rows[rows.length - 1];
                    const candle = parseCandleRow(row);
                    if (!candle) return;

                    setPackets((n) => n + 1);
                    setLast(candle);
                    setCandles((prev) => {
                        if (prev.length > 0) {
                            const lastPrev = prev[prev.length - 1];
                            // OKX оновлює поточну свічку з тим самим timestamp — оновлюємо її
                            if (lastPrev.ts === candle.ts) {
                                const next = prev.slice(0, -1);
                                next.push(candle);
                                return next;
                            }
                        }
                        const next = [...prev, candle];
                        if (next.length > 240) next.shift(); // обмеження буфера
                        return next;
                    });
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
    }, [subscribeCandles]);

    // Життєвий цикл: перевірка instId → конект
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

            setCandles([]);
            setLast(null);
            setPackets(0);
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

    // Якщо міняємо інструмент на льоту — відпишемося від попереднього каналу і підпишемося на новий
    const prevArgRef = useRef<OkxArg | null>(null);
    useEffect(() => {
        const prev = prevArgRef.current;
        if (prev && (prev.instId !== arg.instId || prev.channel !== arg.channel)) {
            unsubscribeCandles(prev);
            setCandles([]);
            setLast(null);
            setPackets(0);
            subscribeCandles(); // на відкритому сокеті перемикаємось швидко
        }
        prevArgRef.current = arg;
    }, [arg, subscribeCandles, unsubscribeCandles]);

    const lastInfo = last
        ? `${dtFmt.format(new Date(last.ts))}  O:${nf2.format(last.open)}  H:${nf2.format(last.high)}  L:${nf2.format(last.low)}  C:${nf2.format(last.close)}`
        : "—";

    return (
        <div className="rounded-2xl bg-white/70 backdrop-blur p-4 shadow-soft">
            {/* Верхня панель стану */}
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

            {/* Графік свічок */}
            <div className="mt-4">
                <CandlesChart candles={candles} height={220} maxBars={140} />
            </div>

            {/* Остання свічка */}
            <div className="mt-3 rounded-lg bg-white/60 p-3 text-sm text-slate-800">
                <div className="text-slate-500 text-xs mb-1">Остання свічка:</div>
                <div className="font-mono">{lastInfo}</div>
            </div>

            {!last && !err && (
                <p className="mt-3 text-slate-600">
                    Чекаємо дані з OKX ({CHANNEL} {instId})…
                </p>
            )}
        </div>
    );
}
