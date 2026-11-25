
import { NextResponse } from "next/server";
import { MultiTrader } from "@/utils/multiTrader";
import { getPrice } from "@/lib/okxClient";
import { getDb } from "@/lib/mongo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getCronTokenFromReq(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("token");
  const auth = req.headers.get("authorization") || "";

  if (q) return q;
  if (auth.toLowerCase().startsWith("bearer ")) {
    return auth.slice(7).trim();
  }

  return auth || null;
}

export async function GET(req: Request) {
  try {
    const token = getCronTokenFromReq(req);
    const expected = process.env.CRON_SECRET;

    if (!expected || token !== expected) {
      return NextResponse.json(
        { ok: false, message: "invalid cron token" },
        { status: 401 }
      );
    }

    const capitalUsd = Number(process.env.MULTI_CAPITAL_USD || 1000);

    const multiStrategy = {
      id: "multi-5-default-v3",
      name: "FiveDynamic",
      instIds: [
        "BTC-USDT",
        "ETH-USDT",
        "SOL-USDT",
        "ADA-USDT",
        "XRP-USDT",
      ],
      baseAllocationPct: 0.1,
      maxAllocationPct: 0.6,

      staircase: [
        { pctDrop: 0.003, amountPct: 0.05 },
        { pctDrop: 0.006, amountPct: 0.1 },
        { pctDrop: 0.010, amountPct: 0.2 },
        { pctDrop: 0.015, amountPct: 0.3 },
        { pctDrop: 0.020, amountPct: 0.35 },
      ],

      stopLossPct: 0.01,
      takeProfitPct: 0.012,
      rebalanceIntervalSec: 1800,
    };

    const db = await getDb();

    const mt = new MultiTrader({
      strategy: multiStrategy,
      capitalUsd,
      getDb: async () => db,
    });

    await mt.loadState();

    const prices = await Promise.all(
      multiStrategy.instIds.map(async (instId) => {
        const price = await getPrice(instId);

        if (!Number.isFinite(price) || price <= 0) {
          throw new Error(`Invalid price for ${instId}: ${price}`);
        }

        return { instId, price };
      })
    );

    const unallocated = mt.state.instStates.every(
      (s: any) => (s.allocatedUsd || 0) === 0
    );

    if (unallocated) {
      await mt.initializePortfolio(prices);

      return NextResponse.json({
        ok: true,
        initialized: true,
        strategyId: multiStrategy.id,
        capitalUsd,
        allocationPerCoin: capitalUsd * 0.1,
        allocatedTotal: capitalUsd * 0.5,
        cashUsd: capitalUsd * 0.5,
        executed: 0,
        orders: [],
      });
    }

  const multiRes = await mt.onTick(prices);

return NextResponse.json({
  ok: true,
  strategyId: multiStrategy.id,
  cashUsd: mt.state.cashUsd,
  multi: {
    executed: multiRes.orders.length,
    orders: multiRes.orders,
    // diagnostics: multiRes.diagnostics,
  },
});
  } catch (err) {
    console.error("multi-tick error", err);

    return NextResponse.json(
      { ok: false, message: String(err) },
      { status: 500 }
    );
  }
}