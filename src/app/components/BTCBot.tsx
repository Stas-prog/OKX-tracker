"use client";

import React, { useEffect, useState, useRef } from "react";

const BTCBot: React.FC = () => {
    const [price, setPrice] = useState<number | null>(null);
    const [sma, setSma] = useState<number | null>(null);
    const [signal, setSignal] = useState<"BUY" | "SELL" | "WAIT">("WAIT");

    const pricesBuffer = useRef<number[]>([]); // зберігаємо останні N цін
    const SMA_PERIOD = 14; // період SMA

    useEffect(() => {
        const ws = new WebSocket("wss://stream.binance.com:9443/ws/btcusdt@trade");

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            const currentPrice = parseFloat(data.p); // ціна BTC
            setPrice(currentPrice);

            // Додаємо нову ціну в буфер
            pricesBuffer.current.push(currentPrice);
            if (pricesBuffer.current.length > SMA_PERIOD) {
                pricesBuffer.current.shift();
            }

            // Рахуємо SMA
            if (pricesBuffer.current.length === SMA_PERIOD) {
                const avg =
                    pricesBuffer.current.reduce((a, b) => a + b, 0) /
                    pricesBuffer.current.length;
                setSma(avg);

                // Генеруємо сигнал
                if (currentPrice > avg) {
                    setSignal("BUY");
                } else if (currentPrice < avg) {
                    setSignal("SELL");
                } else {
                    setSignal("WAIT");
                }
            }
        };

        ws.onerror = (err) => {
            console.error("WebSocket error:", err);
        };

        return () => {
            ws.close();
        };
    }, []);

    return (
        <div className="bg-gray-900 p-4 rounded-lg shadow-lg text-white mt-8 max-w-sm mx-auto">
            <h2 className="text-lg font-bold mb-2">BTC Mini Bot</h2>
            <p>📈 Поточна ціна: {price ? price.toFixed(2) : "Завантаження..."}</p>
            <p>📊 SMA({SMA_PERIOD}): {sma ? sma.toFixed(2) : "Недостатньо даних"}</p>
            <p>
                🔔 Сигнал:{" "}
                <span
                    className={
                        signal === "BUY"
                            ? "text-green-400 font-bold"
                            : signal === "SELL"
                                ? "text-red-400 font-bold"
                                : "text-yellow-400 font-bold"
                    }
                >
                    {signal}
                </span>
            </p>
        </div>
    );
};

export default BTCBot;
