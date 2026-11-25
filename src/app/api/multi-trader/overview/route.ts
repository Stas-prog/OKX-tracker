
import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const db = await getDb();
    const strategyId = "multi-5-default-v3";

    const state = await db
      .collection("multi_state")
      .findOne({ strategyId });

    const trades = await db
      .collection("multi_trades")
      .find({ strategyId })
      .sort({ createdAt: -1 })
      .limit(100)
      .toArray();

    return NextResponse.json({
      ok: true,
      strategyId,
      state,
      trades,
    });
  } catch (error) {
    console.error("MultiTrader overview error:", error);

    return NextResponse.json(
      { ok: false, message: "Failed to load MultiTrader data" },
      { status: 500 }
    );
  }
}