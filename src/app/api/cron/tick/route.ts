export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

const LOCK_ID = "cron-lock";
const MIN_INTERVAL_MS = 60_000; // мінімальна пауза між тиками

type LockDoc = {
  _id: string;                 // "cron-lock"
  heldBy?: string;             // ідентифікатор воркера (Vercel instance id)
  until?: string;              // ISO, коли блок закінчується
  lastRunAt?: string;          // ISO
  updatedAt?: string;          // ISO
};

function authOk(req: Request) {
  const bearer = req.headers.get("authorization") || "";
  const token = bearer.startsWith("Bearer ") ? bearer.slice(7) : null;
  const qs = new URL(req.url).searchParams.get("secret");
  const want = process.env.CRON_SECRET;
  return Boolean(want) && (token === want || qs === want);
}

export async function GET(req: Request) {
  if (!authOk(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  if (!process.env.MONGODB_URI) {
    return NextResponse.json({ ok: false, error: "MONGODB_URI not set" }, { status: 500 });
  }

  const db = await getDb();
  const col = db.collection<LockDoc>("cron_locks");

  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // читаємо поточний лок
  const cur = (await col.findOne({ _id: LOCK_ID })) || undefined;
  const untilTs = cur?.until ? Date.parse(cur.until) : 0;
  const lastRunTs = cur?.lastRunAt ? Date.parse(cur.lastRunAt) : 0;

  // якщо лок ще діє або інтервал ще не минув — просто відповідаємо
  if (untilTs > now || (now - lastRunTs) < MIN_INTERVAL_MS) {
    return NextResponse.json({ ok: true, skipped: true, reason: "locked or interval" });
  }

  // пробуємо встановити лок собі на короткий час (щоб не було гонок)
  const holder = process.env.VERCEL_REGION || "local";
  const newDoc: LockDoc = {
    _id: LOCK_ID,
    heldBy: holder,
    until: new Date(now + 30_000).toISOString(), // 30 сек
    lastRunAt: cur?.lastRunAt ?? undefined,
    updatedAt: nowIso,
  };

  await col.updateOne({ _id: LOCK_ID }, { $set: newDoc }, { upsert: true });

  // ---- ВАШ JOB: викликаємо «віртуального трейдера», можна ще що завгодно ----
  let result: any = null;
  try {
    const r = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL ?? ""}/api/virtual-trader`, { cache: "no-store" });
    result = await r.json();
  } catch (e: any) {
    result = { error: e?.message || String(e) };
  }

  // знімаємо лок: фіксуємо lastRunAt і одразу звільняємо
  await col.updateOne(
    { _id: LOCK_ID },
    {
      $set: {
        heldBy: undefined,
        until: new Date(now - 1).toISOString(),
        lastRunAt: nowIso,
        updatedAt: new Date().toISOString(),
      },
    },
    { upsert: true }
  );

  return NextResponse.json({ ok: true, ran: true, result });
}
