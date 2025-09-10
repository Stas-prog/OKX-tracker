export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

type LockDoc = {
  _id: string;
  heldBy?: string | null;
  until?: string | null;
  lastRunAt?: string | null;
  updatedAt?: string | null;
};

export async function GET() {
  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ ok: false, error: "MONGODB_URI not set" }, { status: 500 });
  }
  const db = await getDb();
  const col = db.collection<LockDoc>("cron_locks");
  const doc = (await col.findOne({ _id: "cron-lock" })) || null;
  return NextResponse.json({ ok: true, lock: doc });
}
