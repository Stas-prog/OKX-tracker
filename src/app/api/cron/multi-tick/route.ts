
// import { NextResponse } from "next/server";
// import { MultiTrader } from "@/utils/multiTrader";
// import { getPrice } from "@/lib/okxClient";
// import { getDb } from "@/lib/mongo";

// export const runtime = "nodejs";
// export const dynamic = "force-dynamic";

// function getCronTokenFromReq(req: Request) {
//   const url = new URL(req.url);
//   const q = url.searchParams.get("token");
//   const auth = req.headers.get("authorization") || "";

//   if (q) return q;

//   if (auth.toLowerCase().startsWith("bearer ")) {
//     return auth.slice(7).trim();
//   }

//   return auth || null;
// }

// export async function GET(req: Request) {
//   try {
//     // 1. Авторизація
//     const token = getCronTokenFromReq(req);
//     const expected = process.env.CRON_SECRET;

//     if (!expected || token !== expected) {
//       return NextResponse.json(
//         { ok: false, message: "invalid cron token" },
//         { status: 401 }
//       );
//     }

//     // 2. Параметри стратегії
//     const capitalUsd = Number(process.env.MULTI_CAPITAL_USD || 1000);

//     if (!Number.isFinite(capitalUsd) || capitalUsd <= 0) {
//       throw new Error(`Invalid MULTI_CAPITAL_USD: ${capitalUsd}`);
//     }

//     const multiStrategy = {
//       id: "multi-5-default-v3",
//       name: "FiveDynamic",
//       instIds: [
//         "BTC-USDT",
//         "ETH-USDT",
//         "SOL-USDT",
//         "ADA-USDT",
//         "XRP-USDT",
//       ],
//       baseAllocationPct: 0.1,
//       maxAllocationPct: 0.6,

//       staircase: [
//         { pctDrop: 0.003, amountPct: 0.05 },
//         { pctDrop: 0.006, amountPct: 0.1 },
//         { pctDrop: 0.010, amountPct: 0.2 },
//         { pctDrop: 0.015, amountPct: 0.3 },
//         { pctDrop: 0.020, amountPct: 0.35 },
//       ],

//       stopLossPct: 0.01,
//       takeProfitPct: 0.012,
//       rebalanceIntervalSec: 1800,
//     };

//     // 3. Підключення до MongoDB
//     const db = await getDb();

//     const mt = new MultiTrader({
//       strategy: multiStrategy,
//       capitalUsd,
//       getDb: async () => db,
//     });

//     await mt.loadState();

//     // 4. Отримуємо актуальні ціни
//     const prices = await Promise.all(
//       multiStrategy.instIds.map(async (instId) => {
//         const price = await getPrice(instId);

//         if (!Number.isFinite(price) || price <= 0) {
//           throw new Error(`Invalid price for ${instId}: ${price}`);
//         }

//         return { instId, price };
//       })
//     );

//     // 5. Визначаємо, чи портфель уже ініціалізований.
//     // Важливо: нульові позиції НЕ означають, що портфель новий.
//     const instStates = Array.isArray(mt.state.instStates)
//       ? mt.state.instStates
//       : [];

//     const hasPositionHistory = instStates.some((s: any) => {
//       return (
//         Number(s.quantity || 0) > 1e-12 ||
//         Number(s.allocatedUsd || 0) > 0 ||
//         Boolean(s.lastBuyTimestamp) ||
//         Boolean(s.lastSellTimestamp)
//       );
//     });

//     // Перевіряємо також історію угод — для старих станів без прапорця.
//     const previousTrade = await db
//       .collection("multi_trades")
//       .findOne({ strategyId: multiStrategy.id });

//     const wasPreviouslyInitialized =
//       mt.state.portfolioInitialized === true ||
//       hasPositionHistory ||
//       Boolean(previousTrade);

//     // 6. Міграція старого стану.
//     // Якщо є сліди попередньої роботи, більше не запускаємо початкову купівлю.
//     if (
//       wasPreviouslyInitialized &&
//       mt.state.portfolioInitialized !== true
//     ) {
//       mt.state.portfolioInitialized = true;
//       await mt.saveState();
//     }

//     // 7. Початкова купівля виконується тільки один раз.
//     if (!wasPreviouslyInitialized) {
//       mt.state.portfolioInitialized = true;

//       const initResult = await mt.initializePortfolio(prices);

//       const allocatedTotal = mt.state.instStates.reduce(
//         (sum: number, s: any) =>
//           sum + Number(s.allocatedUsd || 0),
//         0
//       );

//       return NextResponse.json({
//         ok: true,
//         initialized: true,
//         strategyId: multiStrategy.id,
//         capitalUsd,
//         allocatedTotal: Number(allocatedTotal.toFixed(8)),
//         cashUsd: Number(mt.state.cashUsd.toFixed(8)),
//         executed: initResult.orders.length,
//         orders: initResult.orders,
//       });
//     }

//     // 8. Звичайний tick.
//     const multiRes = await mt.onTick(prices);

//     // 9. Контрольні показники після виконання.
//     const allocatedTotal = mt.state.instStates.reduce(
//       (sum: number, s: any) =>
//         sum + Number(s.allocatedUsd || 0),
//       0
//     );

//     const totalQuantity = mt.state.instStates.reduce(
//       (sum: number, s: any) =>
//         sum + Number(s.quantity || 0),
//       0
//     );

//     return NextResponse.json({
//       ok: true,
//       strategyId: multiStrategy.id,
//       portfolioInitialized: true,
//       capitalUsd: mt.state.capitalUsd,
//       cashUsd: Number(mt.state.cashUsd.toFixed(8)),
//       allocatedTotal: Number(allocatedTotal.toFixed(8)),
//       totalQuantity,
//       multi: {
//         executed: multiRes.orders.length,
//         orders: multiRes.orders,
//       },
//     });
//   } catch (err) {
//     console.error("multi-tick error", err);

//     return NextResponse.json(
//       {
//         ok: false,
//         message: String(err),
//       },
//       { status: 500 }
//     );
//   }
// }
