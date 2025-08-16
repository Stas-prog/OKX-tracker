export type TradeRow = {
    side: "BUY" | "SELL";
    price: number;
    qty: number;
    ts: number;
    pnlUSDT?: number;
    instId?: string;
    tf?: "1m" | "5m" | "15m";
    createdAt: string;
};

// Старий зручний хелпер: тепер «розумний» — уміє читати як масив,
// так і об'єкт { items: [...] } з /api/trades.
export async function fetchTrades(params?: {
    limit?: number;
    since?: string;
    before?: string;
    order?: "asc" | "desc";
}): Promise<TradeRow[]> {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.since) q.set("since", params.since);
    if (params?.before) q.set("before", params.before);
    if (params?.order) q.set("order", params.order);
    const r = await fetch(`/api/trades${q.toString() ? "?" + q.toString() : ""}`, { cache: "no-store" });
    const data = await r.json();
    // якщо новий формат — повертаємо data.items; якщо старий — сам data
    if (Array.isArray(data)) return data as TradeRow[];
    if (Array.isArray(data?.items)) return data.items as TradeRow[];
    return []; // на всяк випадок
}

/* Додатковий SDK під розширений /api/trades */
export type TradesQuery = {
    limit?: number;
    page?: number;
    sort?: "createdAt" | "ts" | "price";
    order?: "asc" | "desc";
    side?: "BUY" | "SELL";
    instId?: string;
    tf?: "1m" | "5m" | "15m";
    since?: string;
    before?: string;
    q?: string;
    format?: "json" | "csv";
};

export async function fetchTradesList(qs: TradesQuery = {}) {
    const q = new URLSearchParams();
    if (qs.limit) q.set("limit", String(qs.limit));
    if (qs.page) q.set("page", String(qs.page));
    if (qs.sort) q.set("sort", qs.sort);
    if (qs.order) q.set("order", qs.order);
    if (qs.side) q.set("side", qs.side);
    if (qs.instId) q.set("instId", qs.instId);
    if (qs.tf) q.set("tf", qs.tf);
    if (qs.since) q.set("since", qs.since);
    if (qs.before) q.set("before", qs.before);
    if (qs.q) q.set("q", qs.q);
    if (qs.format) q.set("format", qs.format);
    const r = await fetch(`/api/trades?${q.toString()}`, { cache: "no-store" });
    return r.json();
}
