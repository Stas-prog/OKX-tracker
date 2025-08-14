"use client";

import { useMemo } from "react";

export type Candle = {
    ts: number; open: number; high: number; low: number; close: number; vol: number;
};

export default function CandlesChart({
    candles,
    height = 200,
    maxBars = 120,
}: {
    candles: Candle[];
    height?: number;
    maxBars?: number;
}) {
    // 1) ХУКИ — завжди в одному порядку
    const data = useMemo(() => candles.slice(-maxBars), [candles, maxBars]);

    // Обчислення масштабу з «безпечними» дефолтами для пустих даних
    const H = height;
    const N = Math.max(0, data.length);
    const W = Math.max(320, Math.min(900, Math.max(1, N) * 6));
    const xStep = W / Math.max(1, N - 1);

    const minLow = N ? Math.min(...data.map(c => c.low)) : 0;
    const maxHigh = N ? Math.max(...data.map(c => c.high)) : 1;
    const pad = (maxHigh - minLow) * 0.05;
    const yMin = minLow - (isFinite(pad) ? pad : 0);
    const yMax = maxHigh + (isFinite(pad) ? pad : 1);
    const denom = yMax - yMin || 1;

    const y = (v: number) => H - ((v - yMin) / denom) * H;

    const closePath = useMemo(() => {
        if (N === 0) return "";
        return data.map((c, i) => `${i === 0 ? "M" : "L"} ${i * xStep} ${y(c.close)}`).join(" ");
    }, [N, data, xStep, yMin, yMax, H, denom]);

    // 2) ПІСЛЯ хуків — умовний рендер
    if (N === 0) {
        return (
            <div className="grid h-[200px] w-full place-items-center rounded-lg bg-white/60 text-slate-500">
                Дані завантажуються…
            </div>
        );
    }

    return (
        <div className="w-full overflow-x-auto rounded-xl bg-white/60 p-3 shadow-soft">
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
                {/* Тонка сітка */}
                {Array.from({ length: 4 }).map((_, i) => {
                    const yy = (H / 4) * i;
                    return <line key={i} x1={0} y1={yy} x2={W} y2={yy} stroke="rgba(0,0,0,0.08)" strokeWidth={1} />;
                })}

                {/* Свічки */}
                {data.map((c, i) => {
                    const x = i * xStep;
                    const cx = Math.round(x);
                    const isUp = c.close >= c.open;
                    const top = y(isUp ? c.close : c.open);
                    const bot = y(isUp ? c.open : c.close);
                    const bodyH = Math.max(1, bot - top);
                    const bodyW = Math.max(2, Math.min(5, xStep * 0.6));
                    const color = isUp ? "rgba(34,197,94,0.9)" : "rgba(239,68,68,0.9)";

                    return (
                        <g key={c.ts}>
                            <line x1={cx} y1={y(c.high)} x2={cx} y2={y(c.low)} stroke="rgba(0,0,0,0.35)" strokeWidth={1} />
                            <rect x={cx - bodyW / 2} y={top} width={bodyW} height={bodyH} rx={1.5} fill={color} />
                        </g>
                    );
                })}

                {/* Лінія close */}
                {closePath && <path d={closePath} fill="none" stroke="rgba(30,41,59,0.6)" strokeWidth={1.5} />}
            </svg>
        </div>
    );
}
