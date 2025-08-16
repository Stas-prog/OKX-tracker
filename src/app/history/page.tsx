"use client";

import { useEffect, useMemo, useState } from "react";

type TradeRow = {
    _id: string;
    createdAt: string;
    ts: number;
    instId?: string;
    tf?: "1m" | "5m" | "15m";
    side: "BUY" | "SELL";
    price: number;
    qty: number;
    pnlUSDT?: number;
};

type ApiResp = {
    items: TradeRow[];
    page: number;
    limit: number;
    total: number;
    pages: number;
    sort: "createdAt" | "ts" | "price";
    order: "asc" | "desc";
};

export default function HistoryPage() {
    const [rows, setRows] = useState<TradeRow[]>([]);
    const [loading, setLoading] = useState(true);

    // фільтри
    const [side, setSide] = useState<"" | "BUY" | "SELL">("");
    const [instId, setInstId] = useState<string>("");
    const [tf, setTf] = useState<"" | "1m" | "5m" | "15m">("");
    const [q, setQ] = useState<string>("");

    // пагінація/сортування
    const [limit, setLimit] = useState<number>(50);
    const [page, setPage] = useState<number>(1);
    const [sort, setSort] = useState<"createdAt" | "ts" | "price">("createdAt");
    const [order, setOrder] = useState<"asc" | "desc">("desc");

    const [total, setTotal] = useState(0);
    const pages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);

    async function load() {
        setLoading(true);
        const params = new URLSearchParams();
        params.set("limit", String(limit));
        params.set("page", String(page));
        params.set("sort", sort);
        params.set("order", order);
        if (side) params.set("side", side);
        if (instId) params.set("instId", instId.trim());
        if (tf) params.set("tf", tf);
        if (q.trim()) params.set("q", q.trim());

        const r = await fetch(`/api/trades?${params.toString()}`, { cache: "no-store" });
        const json: ApiResp = await r.json();

        setRows(json.items);
        setTotal(json.total);
        setLoading(false);
    }

    useEffect(() => {
        load().catch(console.error);
    }, [page, limit, sort, order]); // фільтри застосовуємо кнопкою "Застосувати"

    function applyFilters() {
        setPage(1);
        load().catch(console.error);
    }

    function resetFilters() {
        setSide("");
        setInstId("");
        setTf("");
        setQ("");
        setPage(1);
        setSort("createdAt");
        setOrder("desc");
        setLimit(50);
        load().catch(console.error);
    }

    function onSortClick(field: "createdAt" | "ts" | "price") {
        if (sort === field) {
            setOrder(prev => prev === "asc" ? "desc" : "asc");
        } else {
            setSort(field);
            setOrder("desc");
        }
    }

    async function exportCSV() {
        const params = new URLSearchParams();
        params.set("limit", String(limit));
        params.set("page", String(page));
        params.set("sort", sort);
        params.set("order", order);
        if (side) params.set("side", side);
        if (instId) params.set("instId", instId.trim());
        if (tf) params.set("tf", tf);
        if (q.trim()) params.set("q", q.trim());
        params.set("format", "csv");

        const res = await fetch(`/api/trades?${params.toString()}`, { cache: "no-store" });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `trades_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 8 });

    return (
        <main className="min-h-screen p-6 sm:p-10 bg-black text-white">
            <h1 className="text-2xl sm:text-3xl font-bold mb-6">📜 Історія торгів</h1>

            {/* Панель фільтрів */}
            <div className="bg-gray-900/80 rounded-lg p-4 mb-4 border border-gray-800">
                <div className="flex flex-col sm:flex-row gap-3">
                    <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-300">Side</label>
                        <select
                            className="bg-gray-800 border border-gray-700 rounded px-2 py-1"
                            value={side}
                            onChange={(e) => setSide(e.target.value as any)}
                        >
                            <option value="">All</option>
                            <option value="BUY">BUY</option>
                            <option value="SELL">SELL</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-300">Inst</label>
                        <input
                            className="bg-gray-800 border border-gray-700 rounded px-2 py-1"
                            placeholder="BTC-USDT"
                            value={instId}
                            onChange={(e) => setInstId(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-300">TF</label>
                        <select
                            className="bg-gray-800 border border-gray-700 rounded px-2 py-1"
                            value={tf}
                            onChange={(e) => setTf(e.target.value as any)}
                        >
                            <option value="">All</option>
                            <option value="1m">1m</option>
                            <option value="5m">5m</option>
                            <option value="15m">15m</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2 flex-1">
                        <label className="text-sm text-gray-300">Пошук</label>
                        <input
                            className="bg-gray-800 border border-gray-700 rounded px-2 py-1 w-full"
                            placeholder='напр. "BTC buy"'
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                        />
                    </div>

                    <div className="flex items-center gap-2">
                        <label className="text-sm text-gray-300">Limit</label>
                        <select
                            className="bg-gray-800 border border-gray-700 rounded px-2 py-1"
                            value={limit}
                            onChange={(e) => setLimit(parseInt(e.target.value, 10))}
                        >
                            <option value={20}>20</option>
                            <option value={50}>50</option>
                            <option value={100}>100</option>
                            <option value={200}>200</option>
                            <option value={500}>500</option>
                        </select>
                    </div>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={applyFilters}
                            className="bg-emerald-600 hover:bg-emerald-500 rounded px-3 py-1 text-sm"
                        >
                            Застосувати
                        </button>
                        <button
                            onClick={resetFilters}
                            className="bg-gray-700 hover:bg-gray-600 rounded px-3 py-1 text-sm"
                        >
                            Скинути
                        </button>
                    </div>
                </div>
            </div>

            {/* Таблиця */}
            <div className="bg-gray-900/80 rounded-lg border border-gray-800 overflow-x-auto">
                <table className="w-full text-sm">
                    <thead className="text-gray-400 border-b border-gray-800">
                        <tr>
                            <Th label="Time" field="createdAt" sort={sort} order={order} onClick={onSortClick} />
                            <th className="py-2 px-2 text-left">Inst</th>
                            <th className="py-2 px-2 text-left">TF</th>
                            <th className="py-2 px-2 text-left">Side</th>
                            <Th label="Price" field="price" sort={sort} order={order} onClick={onSortClick} right />
                            <th className="py-2 px-2 text-right">Qty</th>
                            <th className="py-2 px-2 text-right">PnL</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td className="py-6 px-4 text-gray-400" colSpan={7}>⏳ Завантаження…</td></tr>
                        ) : rows.length === 0 ? (
                            <tr><td className="py-6 px-4 text-gray-400" colSpan={7}>Нічого не знайдено…</td></tr>
                        ) : (
                            rows.map((r) => (
                                <tr key={r._id} className="border-t border-gray-800">
                                    <td className="py-1 px-2 text-gray-300">{formatTs(r.createdAt)}</td>
                                    <td className="py-1 px-2">{r.instId ?? "—"}</td>
                                    <td className="py-1 px-2">{r.tf ?? "—"}</td>
                                    <td className={`py-1 px-2 ${r.side === "BUY" ? "text-emerald-400" : "text-rose-400"}`}>{r.side}</td>
                                    <td className="py-1 px-2 text-right font-mono">{nf.format(r.price)}</td>
                                    <td className="py-1 px-2 text-right font-mono">{nf.format(r.qty)}</td>
                                    <td className={`py-1 px-2 text-right font-mono ${r.pnlUSDT == null ? "" : r.pnlUSDT >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                                        {r.pnlUSDT == null ? "—" : nf.format(r.pnlUSDT)}
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>

            {/* Пагінація + CSV */}
            <div className="mt-4 flex flex-col sm:flex-row items-center gap-3">
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setPage(p => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded px-3 py-1 text-sm"
                    >
                        ⬅️ Попередня
                    </button>
                    <div className="text-sm text-gray-300">
                        Сторінка {page} з {pages} (усього {total})
                    </div>
                    <button
                        onClick={() => setPage(p => Math.min(pages, p + 1))}
                        disabled={page >= pages}
                        className="bg-gray-800 hover:bg-gray-700 disabled:opacity-50 rounded px-3 py-1 text-sm"
                    >
                        Наступна ➡️
                    </button>
                </div>

                <div className="sm:ml-auto">
                    <button
                        onClick={exportCSV}
                        className="bg-indigo-600 hover:bg-indigo-500 rounded px-3 py-1 text-sm"
                    >
                        ⬇️ Експорт CSV
                    </button>
                </div>
            </div>
        </main>
    );
}

function Th({
    label, field, sort, order, onClick, right = false,
}: {
    label: string;
    field: "createdAt" | "ts" | "price";
    sort: "createdAt" | "ts" | "price";
    order: "asc" | "desc";
    onClick: (f: "createdAt" | "ts" | "price") => void;
    right?: boolean;
}) {
    const is = sort === field;
    return (
        <th
            onClick={() => onClick(field)}
            className={`py-2 px-2 text-left cursor-pointer select-none ${right ? "text-right" : ""}`}
            title="Натисни для сортування"
        >
            {label}{" "}
            <span className="text-gray-500">
                {is ? (order === "asc" ? "▲" : "▼") : "⋯"}
            </span>
        </th>
    );
}

function formatTs(iso: string) {
    try { return new Date(iso).toLocaleString(); } catch { return iso; }
}
