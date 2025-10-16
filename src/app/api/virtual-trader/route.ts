
// export const dynamic = "force-dynamic";
// export const runtime = "nodejs";
// export const revalidate = 0;

// import { NextResponse } from "next/server";
// import { checkAllStrategies } from "@/utils/virtualTrader";
// import { getDb } from "@/lib/mongo";

// type VtStatePick = { _id: string; pnl?: number; lastAction?: "buy"|"sell"|"hold" };

// export async function GET() {
//   try {
//     const res = await checkAllStrategies(); 
//     const instIds: string[] = res.map((r) => String(r.instId));

//     const db = await getDb();
//     const agg = await db.collection("vt_trades").aggregate([
//       { $match: { instId: { $in: instIds }, pnl: { $exists: true } } },
//       { $group: { _id: "$instId", realized: { $sum: "$pnl" } } },
//     ]).toArray();

//     const realizedMap: Record<string, number> = {};
//     for (const a of agg) realizedMap[a._id as string] = Number(a.realized) || 0;

//     const states = await db
//       .collection<VtStatePick>("vt_state")
//       .find({ _id: { $in: instIds } })
//       .project({ _id: 1, pnl: 1, lastAction: 1 })
//       .toArray();

//     const stateMap = Object.fromEntries(states.map((s) => [s._id, s]));

//     const out = res.map((r) => {
//       const realized = realizedMap[r.instId];
//       const fallback = Number(stateMap[r.instId]?.pnl ?? 0);
//       return {
//         instId: String(r.instId || "UNKNOWN"),
//         currentPrice: Number(r.currentPrice) || 0,
//         entryPrice: r.entryPrice != null ? Number(r.entryPrice) : null,
//         position: (r.position as "none" | "long") || "none",
//         lastAction:
//           (r.lastAction as "buy" | "sell" | "hold") ||
//           (stateMap[r.instId]?.lastAction ?? "hold"),
//         pnl: Number.isFinite(realized) ? realized : fallback,
//       };
//     });

//     return NextResponse.json(out);
//   } catch (e) {
//     console.error("virtual-trader error:", e);
//     return NextResponse.json({ error: "virtual-trader failed" }, { status: 500 });
//   }
// }



// export const dynamic = "force-dynamic";
// export const runtime = "nodejs";
// export const revalidate = 0;

// import { NextResponse } from "next/server";
// import { checkAllStrategies } from "@/utils/virtualTrader";
// import { getDb } from "@/lib/mongo";

// // мінімальний тип для читання state у цьому роуті
// type VtStatePick = {
//   _id: string;                               
//   pnl?: number;
//   lastAction?: "buy" | "sell" | "hold";
// };

// type VTTradeDoc = {
//   _id: string;              
//   instId: string;
//   ts: string;                 // ISO
//   side: "buy" | "sell" | "hold";
//   price: number;
//   quantity?: number;
//   amountUsd?: number;
//   reason?: string;
//   pnl?: number;               
//   createdAt: string;
// };

// export async function GET() {
//   try {
//     // 1) Тік логіки (оновлює vt_state/vt_trades)
//     const res = await checkAllStrategies(); // [{ instId, currentPrice, entryPrice, position, pnl, lastAction, ... }]
//     const instIds: string[] = res.map((r) => String(r.instId));
// // console.log(instIds)
//     const db = await getDb();

//     // 2) Реалізований PnL з vt_tradesan (поля з pnl існують тільки на sell/timeout)
//     const ag = await db.collection<VTTradeDoc>("vt_tradesan").findOne()
// ;

//     // const agg = await db.collection("vt_tradesan").aggregate([
//     //   { $match: { instId: { $in: instIdss }, pnl: { $exists: true } } },
//     //   { $group: { _id: "$instId", realized: { $sum: "$pnl" } } },
//     // ]).toArray();
// // console.log("agg", ag)

//     // const realizedMap: Record<string, number> = {};
//     // for (const a of agg) {
//     //   realizedMap[a._id as string] = Number(a.realized) || 0;
//     // }

//     // 3) Підтягуємо state.pnl і lastAction як fallback
//     //    ВАЖЛИВО: вкажемо <VtStatePick> щоб _id був string, а не ObjectId
//     const states = await db
//       .collection<VtStatePick>("vt_state")
//       .find({ instId: { $in: instIds } })
//       .project({ instId: 1, pnl: 1, lastAction: 1 })
//       .toArray();

//     const stateMap = Object.fromEntries(states.map((s) => [s.instId, s]));
// // console.log(stateMap)
//     // 4) Відповідь для таблиці
//     const out = res.map((r) => {
//       const realized = ag?.pnl;
// // console.log("realized",realized)
//       const stateFallback = Number(stateMap[r.instId]?.pnl ?? 0);
//       return {
//         source: "vt_tradesan",
//         instId: String(r.instId || "UNKNOWN"),
//         price: Number(r.currentPrice) || 0,
//         entryPrice: r.entryPrice != null ? Number(r.entryPrice) : null,
//         position: (r.position as "none" | "long") || "none",
//         lastAction:
//           (r.lastAction as "buy" | "sell" | "hold") ||
//           (stateMap[r.instId]?.lastAction ?? "hold"),
//         pnl: Number.isFinite(realized) ? realized : stateFallback,
//       };
//     });

//     return NextResponse.json(out);
//   } catch (e) {
//     console.error("virtual-trader error:", e);
//     return NextResponse.json({ error: "virtual-trader failed" }, { status: 500 });
//   }
// }
