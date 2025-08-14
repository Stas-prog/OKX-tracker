"use client";

import { useMemo } from "react";

export type Candle = {
    ts: number; open: number; high: number; low: number; close: number; vol: number;
};

export type Trade = {
    side: "BUY" | "SELL";
    price: number;
    qty: number;
    ts: number;
    pnlUSDT?: number;
};

export default function CandlesChart({
    candles,
    height = 220,
    maxBars = 140,
    ema12,
    ema26,
    trades = [],
}: {
    candles: Candle[];
    height?: number;
    maxBars?: number;
    ema12?: number[];
    ema26?: number[];
    trades?: Trade[];
}) {
    // 1) ХУКИ — завжди в одному порядку
    const data = useMemo(() => candles.slice(-maxBars), [candles, maxBars]);

    const H = height;
    const N = Math.max(0, data.length);
    const W = Math.max(320, Math.min(1000, Math.max(1, N) * 6));
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

    const ema12Path = useMemo(() => {
        if (!ema12 || ema12.length === 0 || N === 0) return "";
        const series = ema12.slice(-(data.length));
        return series.map((v, i) => `${i === 0 ? "M" : "L"} ${i * xStep} ${y(v)}`).join(" ");
    }, [ema12, N, data.length, xStep, yMin, yMax, H, denom]);

    const ema26Path = useMemo(() => {
        if (!ema26 || ema26.length === 0 || N === 0) return "";
        const series = ema26.slice(-(data.length));
        return series.map((v, i) => `${i === 0 ? "M" : "L"} ${i * xStep} ${y(v)}`).join(" ");
    }, [ema26, N, data.length, xStep, yMin, yMax, H, denom]);

    // Зручна мапа ts->індекс для маркерів
    const indexByTs = useMemo(() => {
        const m = new Map<number, number>();
        data.forEach((c, i) => m.set(c.ts, i));
        return m;
    }, [data]);

    // 2) ПІСЛЯ хуків — умовний рендер
    if (N === 0) {
        return (
            <div className="grid h-[220px] w-full place-items-center rounded-lg bg-white/60 text-slate-500">
                Дані завантажуються…
            </div>
        );
    }

    return (
        <div className="w-full overflow-x-auto rounded-xl bg-white/60 p-3 shadow-soft">
            <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block">
                {/* Сітка */}
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
                {closePath && <path d={closePath} fill="none" stroke="rgba(30,41,59,0.45)" strokeWidth={1.2} />}

                {/* EMA */}
                {ema26Path && <path d={ema26Path} fill="none" stroke="rgba(59,130,246,0.9)" strokeWidth={1.5} />} {/* синювата */}
                {ema12Path && <path d={ema12Path} fill="none" stroke="rgba(234,179,8,0.9)" strokeWidth={1.5} />}  {/* золотава */}

                {/* Маркери угод */}
                {trades.map((t, i) => {
                    const idx = indexByTs.get(t.ts);
                    if (idx == null) return null;
                    const cx = idx * xStep;
                    const cy = y(t.price);
                    const fill = t.side === "BUY" ? "rgba(34,197,94,0.95)" : "rgba(239,68,68,0.95)";
                    // ромбик
                    const size = 5;
                    return (
                        <polygon
                            key={i}
                            points={`${cx},${cy - size} ${cx + size},${cy} ${cx},${cy + size} ${cx - size},${cy}`}
                            fill={fill}
                            stroke="white"
                            strokeWidth={1}
                        />
                    );
                })}
            </svg>
        </div>
    );
}
