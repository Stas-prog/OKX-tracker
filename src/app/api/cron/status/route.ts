export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

type CronMeta = {
  _id: string;
  lastRunAt?: string;
  lastSummary?: any;
};

export async function GET() {
  const db = await getDb();
  const col = db.collection<CronMeta>("cron_meta");
  const doc = await col.findOne({ _id: "vt-heartbeat" });
  return NextResponse.json(doc ?? { _id: "vt-heartbeat", lastRunAt: null });
}
