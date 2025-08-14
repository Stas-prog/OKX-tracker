import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

// Опис документу у колекції "state": _id — РЯДОК, а не ObjectId
type StateDoc = {
    _id: string;                 // напр. "sim"
    instId?: string;
    tf?: "1m" | "5m" | "15m";
    sim?: any;
    candles?: any[];
    updatedAt?: string;
};

export async function GET() {
    const db = await getDb();
    const col = db.collection<StateDoc>("state");
    const doc = await col.findOne({ _id: "sim" });
    return NextResponse.json(doc ?? {});
}

export async function POST(req: Request) {
    const body = (await req.json()) as Partial<StateDoc> & { _id?: string };
    const db = await getDb();
    const col = db.collection<StateDoc>("state");

    const _id = body._id ?? "sim";
    await col.updateOne({ _id }, { $set: { ...body, _id } }, { upsert: true });

    return NextResponse.json({ ok: true });
}
