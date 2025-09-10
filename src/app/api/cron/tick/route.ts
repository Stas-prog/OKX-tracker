export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { checkAllStrategies } from "@/utils/virtualTrader";
import { getDb } from "@/lib/mongo";

type CronMeta = {
  _id: string;               // наприклад: "vt-heartbeat"
  lastRunAt: string;         // ISO
  lastSummary?: any;         // вільна форма (результат перевірок)
};

export async function GET() {
  try {
    const summary = await checkAllStrategies();

    const db = await getDb();
    const col = db.collection<CronMeta>("cron_meta");

    await col.updateOne(
      { _id: "vt-heartbeat" },
      { $set: { lastRunAt: new Date().toISOString(), lastSummary: summary } },
      { upsert: true }
    );

    return NextResponse.json({ ok: true, items: summary.length });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
