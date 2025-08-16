export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

type SettingsDoc = {
    _id: string; // "bot-settings"
    emaFast: number;
    emaSlow: number;
    takeProfit: number; // 0.04 -> 4%
    stopLoss: number;   // 0.02 -> 2%
    feeRate: number;    // 0.001 -> 0.1%
    slippage: number;   // 0.0005 -> 0.05%
    maxBars: number;    // 400
    updatedAt: string;
};

const DEFAULTS: SettingsDoc = {
    _id: "bot-settings",
    emaFast: 8,          // було 12
    emaSlow: 21,         // було 26
    takeProfit: 0.006,   // 0.6% (було 4%)
    stopLoss: 0.004,     // 0.4% (було 2%)
    feeRate: 0.001,
    slippage: 0.0005,
    maxBars: 600,        // трохи довше тримаємо історію
    updatedAt: new Date().toISOString(),
};


export async function GET() {
    const db = await getDb();
    const col = db.collection<SettingsDoc>("settings");
    const doc = await col.findOne({ _id: "bot-settings" });
    return NextResponse.json(doc ?? DEFAULTS);
}

export async function POST(req: Request) {
    const body = (await req.json()) as Partial<SettingsDoc>;
    const db = await getDb();
    const col = db.collection<SettingsDoc>("settings");
    const now = new Date().toISOString();
    const payload = { ...DEFAULTS, ...body, _id: "bot-settings", updatedAt: now };
    await col.updateOne({ _id: "bot-settings" }, { $set: payload }, { upsert: true });
    return NextResponse.json({ ok: true, updatedAt: now });
}
