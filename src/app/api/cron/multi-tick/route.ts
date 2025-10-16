import { NextResponse } from "next/server";
import { MultiTrader } from "@/utils/multiTrader";
import { getPrice } from "@/lib/okxClient"; // твій існуючий okxClient
import { getDb } from "@/lib/mongo"; // твій існуючий getDb

// Якщо захочеш запускати ще й virtualTrader паралельно,
// просто імпортуй його тут і викличеш (але зараз вимикаємо).

// Допоміжна функція для токена
function getCronTokenFromReq(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("token");
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (q) return q;
  if (auth.toLowerCase().startsWith("bearer ")) return auth.split(" ")[1];
  return auth || null;
}

export async function GET(req: Request) {
  try {
    const token = getCronTokenFromReq(req);
    const expected = process.env.CRON_SECRET;
    if (!expected || token !== expected) {
      return NextResponse.json({ ok: false, message: "invalid cron token" }, { status: 401 });
    }

    const multiStrategy = {
      id: "multi-5-default",
      name: "FiveDynamic",
      instIds: ["BTC-USDT", "ETH-USDT", "SOL-USDT", "ADA-USDT", "XRP-USDT"],
      baseAllocationPct: 0.16,
      maxAllocationPct: 0.6,
     // Приклад прогресивної драбини для BUY
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
      capitalUsd: Number(process.env.MULTI_CAPITAL_USD || 1000),
      getDb: async () => db,
      // Якщо хочеш реальні ордери — передаси executeOrderFn тут
    });

    await mt.loadState();

    // Тимчасово ціни підставляємо руками (для тесту),
    // потім підключимо твій okxClient
    // const prices = [
    //   { instId: "BTC-USDT", price: 117000 },
    //   { instId: "ETH-USDT", price: 4612 },
    //   { instId: "SOL-USDT", price: 240.65 },
    //   { instId: "ADA-USDT", price: 0.87 },
    //   { instId: "XRP-USDT", price: 3.1 },
    // ];

    const prices = await Promise.all(
  multiStrategy.instIds.map(async (id) => {
    const price = await getPrice(id);
    return { instId: id, price };
  })
);


    const unallocated = mt.state.instStates.every((s: any) => (s.allocatedUsd || 0) === 0);
    if (unallocated) {
      await mt.initializePortfolio(prices);
    }

    const multiRes = await mt.onTick(prices);

    return NextResponse.json({
      ok: true,
      multi: { executed: multiRes.orders.length, orders: multiRes.orders },
    });
  } catch (err) {
    console.error("multi-tick error", err);
    return NextResponse.json({ ok: false, message: String(err) }, { status: 500 });
  }
}
