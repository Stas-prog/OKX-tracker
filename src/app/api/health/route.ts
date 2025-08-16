export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";

export async function GET() {
    return NextResponse.json({
        ok: true,
        time: new Date().toISOString(),
        env: {
            NODE_ENV: process.env.NODE_ENV,
            MONGODB_URI: !!process.env.MONGODB_URI,
            MONGODB_DB: !!process.env.MONGODB_DB,
            TELEGRAM_BOT_TOKEN: !!process.env.TELEGRAM_BOT_TOKEN,
        },
    });
}
