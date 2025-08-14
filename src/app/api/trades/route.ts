import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

export async function GET() {
    const db = await getDb();
    const trades = await db.collection("trades").find({}).sort({ ts: -1 }).limit(500).toArray();
    return NextResponse.json(trades);
}

export async function POST(req: Request) {
    const body = await req.json();
    const db = await getDb();
    await db.collection("trades").insertOne(body);
    return NextResponse.json({ ok: true });
}
