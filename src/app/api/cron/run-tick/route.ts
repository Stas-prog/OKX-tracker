import { NextResponse } from "next/server";
export async function POST(req: Request) {
  const expected = process.env.CRON_SECRET;
  const body = await req.json().catch(()=>({}));
  const token = body?.token || (new URL(req.url).searchParams.get('token'));
  if (!expected || token !== expected) return NextResponse.json({ ok: false, message: "invalid token" }, { status: 401 });

  // викликаємо внутрішній cron (local call)
  // просто форвардим запит на існуючий multi-tick route
  const res = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'http://localhost:3000'}/api/cron/multi-tick?token=${token}`);
  const json = await res.json().catch(()=>({ok:false}));
  return NextResponse.json(json);
}
