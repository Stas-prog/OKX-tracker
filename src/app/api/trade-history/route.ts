export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getTradeHistory } from "@/lib/trade-log";

// GET /api/trade-history?limit=100&since=ISO&before=ISO&order=asc|desc
export async function GET(req: Request) {
    const url = new URL(req.url);
    const limit = url.searchParams.get("limit") ?? undefined;
    const since = url.searchParams.get("since") ?? undefined;
    const before = url.searchParams.get("before") ?? undefined;
    const order = (url.searchParams.get("order") as "asc" | "desc") ?? "desc";

    const items = await getTradeHistory({
        limit: limit ? Math.max(1, Math.min(2000, parseInt(limit, 10))) : undefined,
        since: since || undefined,
        before: before || undefined,
        order,
    });

    return NextResponse.json(items);
}
