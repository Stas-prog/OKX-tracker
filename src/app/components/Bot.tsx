// /components/Bot.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";

type Candle = {
    ts: number;
    open: number;
    high: number;
    low: number;
    close: number;
    vol: number;
};

type Trade = {
    id: number;
    side: "BUY" | "SELL";
    entryPrice: number;
    exitPrice?: number;
    qty: number;
    pnl?: number;
    entryTime: number;
    exitTime?: number;
};

export default function Bot() {
    const wsRef = useRef<WebSocket | null>(null);
    const [connected, setConnected] = useState(false);
    const [lastPrice, setLastPrice] = useState<number | null>(null);
    const [closes, setCloses] = useState<number[]>([]);
    const [sma20, setSma20] = useState<number | null>(null);
    const [sma50, setSma50] = useState<number | null>(null);
    const [signal, setSignal] = useState<"BUY" | "SELL" | "HOLD">("HOLD");

    const [capital, setCapital] = useState<number>(100); // USDT
    const riskPercent = 0.01; // 1% risk
    const stopLossPct = 0.01; // 1% stop loss
    const takeProfitPct = 0.02; // 2% take profit
    const [position, setPosition] = useState<{
        side: "LONG" | null;
        entryPrice: number;
        qty: number;
        stopLoss: number;
        takeProfit: number;
        entryTime: number;
    } | null>(null);
    const [trades, setTrades] = useState<Trade[]>([]);
    const tradeId = useRef<number>(1);

    // Utilities
    const sma = (arr: number[], period: number) => {
        if (arr.length < period) return null;
        const slice = arr.slice(-period);
        const sum = slice.reduce((a, b) => a + b, 0);
        return sum / period;
    };

    useEffect(() => {
        let ws: WebSocket | null = null;
        let pingInterval: number | undefined;
        let reconnectTimeout: number | undefined;
        let reconnectAttempts = 0;
        let shouldReconnect = true;

        const connectWS = () => {
            ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/public");
            wsRef.current = ws;

            ws.onopen = () => {
                setConnected(true);
                reconnectAttempts = 0;
                console.log("✅ WebSocket connected");

                // Підписка на 1хв свічки BTC-USDT
                try {
                    ws?.send(
                        JSON.stringify({
                            op: "subscribe",
                            args: [
                                {
                                    channel: "candle1m",
                                    instId: "BTC-USDT",
                                },
                            ],
                        })
                    );
                    console.log("Subscribed to candle1m BTC-USDT");
                } catch (e) {
                    console.warn("Subscribe error", e);
                }

                // Пінгуємо сервер кожні 25 секунд, щоб підтримувати зв'язок
                pingInterval = window.setInterval(() => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        try {
                            ws.send("ping");
                            // console.log("ping sent");
                        } catch (e) {
                            console.warn("Ping failed", e);
                        }
                    }
                }, 25000);
            };

            ws.onmessage = (event) => {
                try {
                    // Якщо приходить "pong" або порожній рядок — ігноруємо
                    if (event.data === 'pong' || !event.data.trim()) {
                        return;
                    }

                    const parsed = JSON.parse(event.data);

                    console.log("WS message:", parsed); // Для дебагу

                    // Далі твоя логіка обробки parsed
                    if (parsed && parsed.arg && parsed.data) {
                        // приклад: оновлення ціни
                        const lastPrice = parsed.data[0]?.last;
                        if (lastPrice) {
                            setLastPrice(parseFloat(lastPrice));
                        }
                    }

                } catch (err) {
                    console.error("WS parse error:", err, "Raw message:", event.data);
                }
            };


            ws.onclose = () => {
                setConnected(false);
                console.log("❌ WebSocket disconnected");
                // Очистка ping
                if (pingInterval) {
                    clearInterval(pingInterval);
                    pingInterval = undefined;
                }

                if (!shouldReconnect) return;

                // exponential backoff up to 30s
                const delay = Math.min(30000, 1000 * Math.pow(2, reconnectAttempts));
                reconnectAttempts += 1;
                console.log(`Reconnect in ${delay / 1000}s (attempt ${reconnectAttempts})`);
                reconnectTimeout = window.setTimeout(() => {
                    connectWS();
                }, delay);
            };

            ws.onerror = (e) => {
                console.error("WS error", e);
                // force close to trigger reconnect logic
                try {
                    ws?.close();
                } catch (_) { }
            };
        };

        connectWS();

        return () => {
            shouldReconnect = false;
            if (pingInterval) clearInterval(pingInterval);
            if (reconnectTimeout) clearTimeout(reconnectTimeout);
            try {
                wsRef.current?.close();
            } catch (_) { }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleClosedCandle = (
        tsStr: any,
        openStr: any,
        highStr: any,
        lowStr: any,
        closeStr: any,
        volStr: any
    ) => {
        const ts = typeof tsStr === "string" && tsStr.includes("T") ? Date.parse(tsStr) : Number(tsStr);
        const open = Number(openStr);
        const high = Number(highStr);
        const low = Number(lowStr);
        const close = Number(closeStr);
        const vol = Number(volStr);

        // Оновлюємо останню ціну (закриття свічки)
        setLastPrice(close);

        setCloses((prev) => {
            const maxLen = 500; // keep recent history
            const next = [...prev, close].slice(-maxLen);
            // compute SMAs
            const s20 = sma(next, 20);
            const s50 = sma(next, 50);
            setSma20(s20);
            setSma50(s50);

            if (s20 !== null && s50 !== null) {
                const prev20 = sma(next.slice(0, -1), 20);
                const prev50 = sma(next.slice(0, -1), 50);
                if (prev20 !== null && prev50 !== null) {
                    if (prev20 < prev50 && s20 > s50) {
                        setSignal("BUY");
                        tryEnterPosition(close);
                    } else if (prev20 > prev50 && s20 < s50) {
                        setSignal("SELL");
                        tryExitPosition(close, "signal");
                    } else {
                        setSignal("HOLD");
                        checkStops(close);
                    }
                } else {
                    setSignal("HOLD");
                    checkStops(close);
                }
            } else {
                setSignal("HOLD");
                checkStops(close);
            }

            return next;
        });
    };

    const tryEnterPosition = (price: number) => {
        if (position) return; // only one position at a time
        const riskAmount = capital * riskPercent; // USDT risked
        const stopLossDistance = price * stopLossPct; // USDT distance per unit price
        const qty = riskAmount / stopLossDistance; // BTC amount
        if (qty <= 0) return;
        const stopLossPrice = price - stopLossDistance;
        const takeProfitPrice = price + price * takeProfitPct;

        const newPos = {
            side: "LONG" as const,
            entryPrice: price,
            qty,
            stopLoss: stopLossPrice,
            takeProfit: takeProfitPrice,
            entryTime: Date.now(),
        };
        setPosition(newPos);
        console.log("Entered LONG", newPos);
        setTrades((t) => [
            ...t,
            {
                id: tradeId.current++,
                side: "BUY",
                entryPrice: price,
                qty,
                entryTime: Date.now(),
            },
        ]);
    };

    const tryExitPosition = (price: number, reason: "signal" | "stop" | "tp" = "signal") => {
        if (!position) return;
        const entryPrice = position.entryPrice;
        const qty = position.qty;
        const pnl = (price - entryPrice) * qty; // USDT
        const feePct = 0.0005;
        const fees = (price * qty + entryPrice * qty) * feePct;
        const pnlNet = pnl - fees;

        setCapital((cap) => Number((cap + pnlNet).toFixed(8)));
        setTrades((t) => {
            return [
                ...t,
                {
                    id: tradeId.current++,
                    side: "SELL",
                    entryPrice,
                    exitPrice: price,
                    qty,
                    pnl: Number(pnlNet.toFixed(8)),
                    entryTime: position.entryTime,
                    exitTime: Date.now(),
                },
            ];
        });

        console.log("Exited position:", { entryPrice, exitPrice: price, qty, pnlNet, reason });
        setPosition(null);
        setSignal("HOLD");
    };

    const checkStops = (price: number) => {
        if (!position) return;
        if (price <= position.stopLoss) {
            tryExitPosition(position.stopLoss, "stop");
        } else if (price >= position.takeProfit) {
            tryExitPosition(position.takeProfit, "tp");
        }
    };

    // Small helper to reset
    const resetAll = () => {
        setCloses([]);
        setSma20(null);
        setSma50(null);
        setLastPrice(null);
        setSignal("HOLD");
        setPosition(null);
        setTrades([]);
        setCapital(100);
        tradeId.current = 1;
    };

    return (
        <div style={{ marginTop: 24, padding: 14, fontFamily: "Inter, Roboto, sans-serif", color: "#e6eef8", background: "#05060a", minHeight: "100vh" }}>
            <h1 style={{ margin: 0, marginBottom: 8 }}>okx-tracker — mini SMA bot (demo)</h1>

            <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 12 }}>
                <div style={{ padding: 10, background: "#0b1220", borderRadius: 8 }}>
                    <div><b>WS:</b> {connected ? <span style={{ color: "#7df29b" }}>connected</span> : <span style={{ color: "#f17d7d" }}>disconnected</span>}</div>
                    <div><b>Pair:</b> BTC-USDT (1m)</div>
                </div>

                <div style={{ padding: 10, background: "#071226", borderRadius: 8 }}>
                    <div><b>Last price:</b> {lastPrice ? lastPrice.toFixed(2) : "—"}</div>
                    <div><b>SMA20:</b> {sma20 ? sma20.toFixed(2) : "—"}</div>
                    <div><b>SMA50:</b> {sma50 ? sma50.toFixed(2) : "—"}</div>
                </div>

                <div style={{ padding: 10, background: "#071226", borderRadius: 8 }}>
                    <div><b>Signal:</b> <span style={{ color: signal === "BUY" ? "#7df29b" : signal === "SELL" ? "#ff8a8a" : "#cbd5e1" }}>{signal}</span></div>
                    <div><b>Capital (USDT):</b> {capital.toFixed(6)}</div>
                    <div><b>Open position:</b> {position ? `LONG ${position.qty.toFixed(8)} @ ${position.entryPrice.toFixed(2)}` : "none"}</div>
                </div>

                <div style={{ marginLeft: "auto" }}>
                    <button onClick={resetAll} style={{ padding: "8px 12px", borderRadius: 8, background: "#2a2f3a", color: "#fff", border: "none" }}>Reset</button>
                </div>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 420px", gap: 12 }}>
                <div style={{ padding: 12, background: "#071226", borderRadius: 8 }}>
                    <h3 style={{ marginTop: 0 }}>Recent candles (last {closes.length} closes)</h3>
                    <div style={{ maxHeight: 360, overflow: "auto", fontSize: 13 }}>
                        {closes.slice().reverse().map((c, idx) => (
                            <div key={idx} style={{ padding: "6px 4px", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                                <span style={{ width: 80, display: "inline-block" }}>{(c).toFixed(2)}</span>
                                <span style={{ marginLeft: 12, color: "#9aa4b2" }}>{idx === 0 ? "latest" : ""}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div style={{ padding: 12, background: "#071226", borderRadius: 8 }}>
                    <h3 style={{ marginTop: 0 }}>Trades / Log</h3>
                    <div style={{ maxHeight: 360, overflow: "auto", fontSize: 13 }}>
                        {trades.slice().reverse().map((t) => (
                            <div key={t.id} style={{ padding: "6px 4px", borderBottom: "1px solid rgba(255,255,255,0.02)" }}>
                                <div><b>{t.side}</b> {t.qty?.toFixed(8)} @ {t.entryPrice?.toFixed(2)}</div>
                                {t.exitPrice && <div style={{ color: t.pnl && t.pnl >= 0 ? "#7df29b" : "#ff8a8a" }}>exit {t.exitPrice.toFixed(2)} PnL: {t.pnl?.toFixed(6)}</div>}
                                <div style={{ color: "#9aa4b2", fontSize: 12 }}>{new Date(t.entryTime).toLocaleString()}</div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div style={{ marginTop: 14, padding: 12, background: "#071226", borderRadius: 8 }}>
                <h3 style={{ marginTop: 0 }}>Notes</h3>
                <ul style={{ marginTop: 0 }}>
                    <li>Risk per trade: {riskPercent * 100}%</li>
                    <li>Stop loss: {stopLossPct * 100}% | Take profit: {takeProfitPct * 100}%</li>
                    <li>This is a demo simulator — no real orders are placed.</li>
                </ul>
            </div>
        </div>
    );
}
