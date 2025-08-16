'use client';

import { useEffect, useMemo, useState } from 'react';

type Row = {
    time: string;
    action: string;
    price: number;
    instId?: string;
    createdAt?: string;
};

export default function TradeHistoryTable() {
    const [history, setHistory] = useState<Row[]>([]);
    const [loading, setLoading] = useState(true);
    const [order, setOrder] = useState<"desc" | "asc">("desc");
    const [limit, setLimit] = useState(50);

    const lastTimestamp = useMemo(() => {
        if (history.length === 0) return null;
        // для order=desc беремо перший (найновіший), для asc — останній
        return (order === "desc" ? history[0] : history[history.length - 1])?.createdAt || null;
    }, [history, order]);

    async function fetchHistory(initial = false) {
        setLoading(initial);
        const params = new URLSearchParams({ order, limit: String(limit) });
        // можна додати since/before при скролі/пагінації
        const res = await fetch(`/api/trade-history?${params.toString()}`, { cache: "no-store" });
        const rows: Row[] = await res.json();
        setHistory(rows);
        setLoading(false);
    }

    useEffect(() => {
        fetchHistory(true);
        const id = setInterval(() => fetchHistory(false), 15000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [order, limit]);

    return (
        <div className="mt-10 bg-gray-900 p-6 rounded shadow w-full max-w-2xl mx-auto">
            <div className="flex items-center gap-3 mb-4">
                <h2 className="text-xl font-bold flex-1">📘 Історія подій / трейдів</h2>
                <label className="text-sm text-gray-300">
                    Порядок:&nbsp;
                    <select
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1"
                        value={order}
                        onChange={(e) => setOrder(e.target.value as "desc" | "asc")}
                    >
                        <option value="desc">Нові згори</option>
                        <option value="asc">Старі згори</option>
                    </select>
                </label>
                <label className="text-sm text-gray-300">
                    Ліміт:&nbsp;
                    <select
                        className="bg-gray-800 border border-gray-700 rounded px-2 py-1"
                        value={limit}
                        onChange={(e) => setLimit(parseInt(e.target.value, 10))}
                    >
                        <option value={20}>20</option>
                        <option value={50}>50</option>
                        <option value={100}>100</option>
                        <option value={500}>500</option>
                    </select>
                </label>
            </div>

            {loading ? (
                <div className="text-gray-400">⏳ Завантаження…</div>
            ) : history.length === 0 ? (
                <div className="text-gray-400">Поки що немає записів…</div>
            ) : (
                <table className="w-full text-sm border border-gray-700">
                    <thead>
                        <tr className="border-b border-gray-700 text-gray-400">
                            <th className="py-1 px-2 text-left">Час</th>
                            <th className="py-1 px-2 text-left">Інструмент</th>
                            <th className="py-1 px-2 text-left">Дія</th>
                            <th className="py-1 px-2 text-right">Ціна</th>
                        </tr>
                    </thead>
                    <tbody>
                        {history.map((t, i) => (
                            <tr key={i} className="border-b border-gray-800">
                                <td className="py-1 px-2 text-gray-300">
                                    {formatTs(t.createdAt || t.time)}
                                </td>
                                <td className="py-1 px-2">{t.instId ?? "—"}</td>
                                <td className="py-1 px-2">{t.action}</td>
                                <td className="py-1 px-2 text-right">{number(t.price)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}

            <div className="text-xs text-gray-500 mt-2">
                Остання мітка: {lastTimestamp ? formatTs(lastTimestamp) : "—"}
            </div>
        </div>
    );
}

function formatTs(iso: string) {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
function number(x: number) {
    return new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 }).format(x);
}
