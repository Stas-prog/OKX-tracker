export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";
import { checkAllStrategies } from "@/utils/virtualTrader";

const LOCK_ID = "cron-lock";
const TTL_MS = 60_000; // 1 хв

type LockDoc = {
  _id: string;
  heldBy: string | null;
  until: string;       // ISO
  lastRunAt: string;   // ISO
  updatedAt: string;   // ISO
};

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  if (!process.env.CRON_SECRET) {
    return NextResponse.json({ ok:false, error:"unauthorized" }, { status: 401 });
  }

  const db = await getDb();
  const col = db.collection<LockDoc>("cron_locks");
  const now = Date.now();

  const cur = await col.findOne({ _id: LOCK_ID });
  const expired = !cur || new Date(cur.until).getTime() <= now;

  if (!expired) {
    return NextResponse.json({ ok:true, ran:false, reason:"locked", lock:cur });
  }

  const heldBy = "vercel-cron";
  const doc: LockDoc = {
    _id: LOCK_ID,
    heldBy,
    until: new Date(now + TTL_MS).toISOString(),
    lastRunAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await col.updateOne({ _id: LOCK_ID }, { $set: doc }, { upsert: true });

  // ВАЖЛИВО: викликаємо логіку без fetch
  const result = await checkAllStrategies();

  // оновимо до “вільно”
  await col.updateOne(
    { _id: LOCK_ID },
    { $set: { heldBy:null, until:new Date(now).toISOString(), updatedAt:new Date().toISOString() } }
  );

  return NextResponse.json({ ok:true, ran:true, result });
}
