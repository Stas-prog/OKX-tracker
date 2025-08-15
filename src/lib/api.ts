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

export async function fetchTrades(params?: { limit?: number; since?: string; before?: string; order?: "asc" | "desc" }): Promise<TradeRow[]> {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.since) q.set("since", params.since);
    if (params?.before) q.set("before", params.before);
    if (params?.order) q.set("order", params.order);
    const r = await fetch(`/api/trades${q.toString() ? "?" + q.toString() : ""}`, { cache: "no-store" });
    return r.json();
}
