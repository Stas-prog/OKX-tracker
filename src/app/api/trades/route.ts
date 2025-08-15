export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

type TradeDoc = {
    _id?: string;
    side: "BUY" | "SELL";
    price: number;
    qty: number;
    ts: number;           // timestamp свічки/угоди
    pnlUSDT?: number;
    instId?: string;
    tf?: "1m" | "5m" | "15m";
    createdAt: string;    // ISO
};

// GET /api/trades?limit=1000&since=ISO&before=ISO&order=asc|desc
export async function GET(req: Request) {
    const url = new URL(req.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "500", 10) || 500, 5000);
    const since = url.searchParams.get("since");   // createdAt > since
    const before = url.searchParams.get("before"); // createdAt < before
    const order = (url.searchParams.get("order") || "asc").toLowerCase() === "desc" ? -1 : 1;

    const db = await getDb();
    const col = db.collection<TradeDoc>("trades");

    const filter: any = {};
    if (since || before) {
        filter.createdAt = {};
        if (since) filter.createdAt.$gt = since;
        if (before) filter.createdAt.$lt = before;
    }

    const items = await col
        .find(filter)
        .sort({ createdAt: order }) // стабільне сортування за часом створення
        .limit(limit)
        .toArray();

    return NextResponse.json(items);
}

export async function POST(req: Request) {
    const body = await req.json() as TradeDoc;
    const db = await getDb();
    await db.collection<TradeDoc>("trades").insertOne(body);
    return NextResponse.json({ ok: true });
}
