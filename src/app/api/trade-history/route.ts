export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getTradeHistory } from "@/utils/virtualTrader";

// GET /api/trade-history?limit=200&instId=BTC-USDT
export async function GET(req: Request) {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 2000);
    const instId = url.searchParams.get("instId") || undefined;

    try {
        const rows = await getTradeHistory(limit, instId);
        return NextResponse.json(rows);
    } catch (e) {
        console.error("trade-history error:", e);
        return NextResponse.json({ error: "trade-history failed" }, { status: 500 });
    }
}
