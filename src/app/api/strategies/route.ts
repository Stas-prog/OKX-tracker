export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { listStrategies, upsertStrategy, deleteStrategy, VTStrategy } from "@/lib/strategiesRepo";

export async function GET() {
  const items = await listStrategies();
  return NextResponse.json({ items });
}

/** POST: upsert 1 або масив */
export async function POST(req: Request) {
  const body = await req.json();
  const payload: VTStrategy[] = Array.isArray(body) ? body : [body];
  const saved: VTStrategy[] = [];
  for (const s of payload) {
    if (!s?.instId) continue;
    saved.push(await upsertStrategy(s));
  }
  return NextResponse.json({ ok: true, saved });
}

/** DELETE: /api/strategies?instId=BTC-USDT */
export async function DELETE(req: Request) {
  const url = new URL(req.url);
  const instId = url.searchParams.get("instId");
  if (!instId) return NextResponse.json({ ok:false, error:"instId required" }, { status:400 });
  await deleteStrategy(instId);
  return NextResponse.json({ ok:true });
}
