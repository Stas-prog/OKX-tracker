import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { addTrade, getTradeHistory, TradeDoc } from "@/lib/trade-log";

// GET ?limit=100
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const limit = Number(url.searchParams.get("limit") || 100);
    const db = await getDb();
    const rows = await getTradeHistory(db, Math.min(Math.max(limit, 1), 500));
    return NextResponse.json({ ok: true, rows });
  } catch (e) {
    console.error("trade-history GET error", e);
    return NextResponse.json({ ok: false, message: String(e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const db = await getDb();
    const body = (await req.json()) as Partial<TradeDoc>;
    if (!body?.instId || !body?.side || !body?.price || !body?.quantity) {
      return NextResponse.json({ ok: false, message: "instId, side, price, quantity required" }, { status: 400 });
    }
    const inserted = await addTrade(db, body as TradeDoc, "trades");
    return NextResponse.json({ ok: true, inserted });
  } catch (e) {
    console.error("trade-history POST error", e);
    return NextResponse.json({ ok: false, message: String(e) }, { status: 500 });
  }
}
