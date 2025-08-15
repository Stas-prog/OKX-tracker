export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

type LeaseDoc = {
  _id: string;        // "sim-lease"
  holderId: string;   // clientId з localStorage
  until: string;      // ISO
  updatedAt: string;
};

const LEASE_ID = "sim-lease";
const TTL_SEC = 90; // оренда на 90 сек

export async function GET() {
  const db = await getDb();
  const col = db.collection<LeaseDoc>("leases");
  const doc = await col.findOne({ _id: LEASE_ID });
  return NextResponse.json(doc ?? {});
}

export async function POST(req: Request) {
  const { holderId } = await req.json() as { holderId: string };
  if (!holderId) return NextResponse.json({ ok: false, error: "holderId required" }, { status: 400 });

  const db = await getDb();
  const col = db.collection<LeaseDoc>("leases");
  const now = Date.now();
  const cur = await col.findOne({ _id: LEASE_ID });

  const renew = (owner: string) => {
    const until = new Date(now + TTL_SEC * 1000).toISOString();
    const doc: LeaseDoc = { _id: LEASE_ID, holderId: owner, until, updatedAt: new Date().toISOString() };
    return col.updateOne({ _id: LEASE_ID }, { $set: doc }, { upsert: true }).then(() => doc);
  };

  if (!cur) {
    const doc = await renew(holderId);
    return NextResponse.json({ ok: true, acquired: true, lease: doc });
  }

  const expired = new Date(cur.until).getTime() < now;
  if (expired || cur.holderId === holderId) {
    const doc = await renew(holderId);
    return NextResponse.json({ ok: true, acquired: true, lease: doc });
  }

  return NextResponse.json({ ok: true, acquired: false, lease: cur });
}
