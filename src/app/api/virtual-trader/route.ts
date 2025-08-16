export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { checkAllStrategies } from "@/utils/virtualTrader";

export async function GET() {
    try {
        const result = await checkAllStrategies();
        return NextResponse.json(result);
    } catch (e) {
        console.error("virtual-trader error:", e);
        return NextResponse.json({ error: "virtual-trader failed" }, { status: 500 });
    }
}
