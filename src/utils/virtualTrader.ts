// src/utils/virtualTrader.ts
// import { getDb } from "@/lib/mongo";
// import { listStrategies, VTStrategy } from "@/lib/strategiesRepo";
// import { placeSpotOrder } from "@/lib/okxClientReal";

// /** ===== Типи ===== */
// type VTStateDoc = {
//   _id: string;                  // instId
//   position: "none" | "long";
//   entryPrice: number | null;
//   enteredAt?: string | null;
//   pnl: number;                  // накопичений PnL (дельта ціни * qty, але зберігаємо як зараз)
//   updatedAt: string;

//   qty?: number;                 // синтетична кількість у позиції
//   cashDeployedUsd?: number;     // скільки USD вкладено (для контролю бюджету)
//   usedBuySteps?: number;        // індекс виконаного buy-кроку
//   usedSellSteps?: number;       // індекс виконаного sell-кроку

//   anchorPrice?: number | null;
//   lastAction?: "buy" | "sell" | "hold";
// };

// type VTTradeDoc = {
//   _id: string;                  // <instId>|<type>|<ts>
//   instId: string;
//   time: string;                 // ISO
//   type: "buy" | "sell" | "timeout-sell";
//   price: number;
//   quantity?: number;
//   amountUsd?: number;
//   reason?: string;
//   pnl?: number;                 // на sell/timeout

//   // Для реальних угод:
//   okxOrderId?: string;
//   createdAt: string;
// };

// /** ===== OKX execution mode ===== */
// const EXEC_MODE = (process.env.OKX_EXECUTION || "paper").toLowerCase(); // 'paper' | 'real'
// const MIN_QTY = parseFloat(process.env.OKX_MIN_QTY || "0.0001"); // мін. кількість базового активу
// const QTY_DP = parseInt(process.env.OKX_QTY_DP || "6", 10);      // кількість знаків після коми для qty

// async function fetchOkxLast(instId: string): Promise<number> {
//   // використовуй наш клієнт getTicker, якщо хочеш єдину точку вхідних цін;
//   // тут залишаю швидкий fetch, як було
//   const r = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`, { cache: "no-store" });
//   const j = await r.json();
//   return parseFloat(j?.data?.[0]?.last ?? "0");
// }

// /** ===== Indexes ===== */
// let ensured = false;
// async function ensureIndexes() {
//   if (ensured) return;
//   const db = await getDb();
//   await Promise.all([
//     db.collection<VTStateDoc>("vt_state").createIndex({ _id: 1 }, { unique: true, name: "_id_unique" }),
//     db.collection<VTTradeDoc>("vt_trades").createIndex({ createdAt: -1 }, { name: "createdAt_desc" }),
//     db.collection<VTTradeDoc>("vt_trades").createIndex({ instId: 1, createdAt: -1 }, { name: "instId_createdAt" }),
//     db.collection("okx_real_trades").createIndex({ createdAt: -1 }, { name: "okx_createdAt_desc" }),
//   ]).catch(() => {});
//   ensured = true;
// }

// /** ===== State helpers ===== */
// async function loadState(instId: string): Promise<VTStateDoc> {
//   await ensureIndexes();
//   const db = await getDb();
//   const col = db.collection<VTStateDoc>("vt_state");

//   let doc = await col.findOne({ _id: instId });
//   if (!doc) {
//     const fresh: VTStateDoc = {
//       _id: instId,
//       position: "none",
//       entryPrice: null,
//       enteredAt: null,
//       pnl: 0,
//       updatedAt: new Date().toISOString(),
//       qty: 0,
//       cashDeployedUsd: 0,
//       usedBuySteps: 0,
//       usedSellSteps: 0,
//       anchorPrice: null,
//       lastAction: "hold",
//     };
//     await col.updateOne({ _id: instId }, { $set: fresh }, { upsert: true });
//     return fresh;
//   }
//   const s = doc as VTStateDoc;
//   if (s.qty == null) s.qty = 0;
//   if (s.cashDeployedUsd == null) s.cashDeployedUsd = 0;
//   if (s.usedBuySteps == null) s.usedBuySteps = 0;
//   if (s.usedSellSteps == null) s.usedSellSteps = 0;
//   if (s.lastAction == null) s.lastAction = "hold";
//   return s;
// }

// async function saveState(s: VTStateDoc) {
//   const db = await getDb();
//   await db.collection<VTStateDoc>("vt_state").updateOne(
//     { _id: s._id },
//     { $set: { ...s, updatedAt: new Date().toISOString() } },
//     { upsert: true }
//   );
// }

// async function appendTrade(t: Omit<VTTradeDoc, "_id" | "createdAt">) {
//   const db = await getDb();
//   const id = `${t.instId}|${t.type}|${Date.parse(t.time)}`;
//   const doc: VTTradeDoc = { _id: id, ...t, createdAt: new Date().toISOString() };
//   await db.collection<VTTradeDoc>("vt_trades").updateOne({ _id: id }, { $set: doc }, { upsert: true });
// }

// async function logRealOrder(row: {
//   instId: string;
//   side: "buy" | "sell";
//   qty: number;
//   price: number;
//   okxRes?: any;
//   reason?: string;
// }) {
//   try {
//     const db = await getDb();
//     await db.collection("okx_real_trades").insertOne({
//       instId: row.instId,
//       side: row.side,
//       qty: row.qty,
//       price: row.price,
//       notional: row.qty * row.price,
//       reason: row.reason,
//       okx: row.okxRes,
//       createdAt: new Date().toISOString(),
//     });
//   } catch (e) {
//     console.error("logRealOrder failed:", e);
//   }
// }

// function toSz(qty: number): string {
//   const q = Math.max(0, qty);
//   const rounded = Math.floor(q * Math.pow(10, QTY_DP)) / Math.pow(10, QTY_DP);
//   return rounded.toFixed(QTY_DP);
// }

// /** ===== ГОЛОВНЕ: обхід стратегій з БД + виконання ордерів ===== */
// export async function checkAllStrategies() {
//   await ensureIndexes();
//   const strategies = await listStrategies();

//   const results: Array<{
//     instId: string;
//     currentPrice: number;
//     position: "none" | "long";
//     lastAction?: "buy" | "sell" | "hold";
//     entryPrice: number | null;
//     pnl: number;
//     anchorPrice?: number | null;
//     qty?: number;
//     cashDeployedUsd?: number;
//     usedBuySteps?: number;
//     usedSellSteps?: number;

//     mode: VTStrategy["mode"];
//     buyBelow?: number;
//     sellAbove?: number;
//     buyPctBelow?: number;
//     sellPctFromEntry?: number;
//     maxHoldMinutes?: number;
//     budgetUsd?: number;
//   }> = [];

//   for (const strat of strategies) {
//     const instId = strat.instId;
//     const s = await loadState(instId);
//     const priceNow = await fetchOkxLast(instId);

//     const mode = strat.mode ?? "relative";
//     const maxHold = Math.max(1, strat.maxHoldMinutes ?? 10);
//     const budget = Math.max(1, strat.budgetUsd ?? 1000);

//     const buyStepPct = strat.buyPctBelow ?? 0.005;
//     const sellStepPct = strat.sellPctFromEntry ?? 0.01;
//     const buyStepsUsd = strat.staircaseBuyUsd ?? [50, 100, 200, 300, 350];
//     const sellFracs = strat.staircaseSellFractions ?? [0.2, 0.33, 0.47];

//     let needSave = false;

//     // --- Anchor & lastAction ---
//     if (s.position === "none") {
//       const base = s.anchorPrice ?? priceNow;
//       const newAnchor = Math.max(base, priceNow);
//       if (newAnchor !== s.anchorPrice) { s.anchorPrice = newAnchor; needSave = true; }
//       if (s.lastAction !== "hold") { s.lastAction = "hold"; needSave = true; }
//     } else {
//       if (!s.anchorPrice && s.entryPrice != null) { s.anchorPrice = s.entryPrice; needSave = true; }
//     }

//     // --- BUY ladder ---
//     if (mode === "relative" && buyStepPct > 0) {
//       const anchor = s.anchorPrice ?? priceNow;
//       while (true) {
//         const k = s.usedBuySteps ?? 0;
//         if (k >= buyStepsUsd.length) break;

//         const requiredDrop = (k + 1) * buyStepPct;
//         const buyThreshold = anchor * (1 - requiredDrop);
//         if (!(priceNow <= buyThreshold)) break;

//         // бюджет
//         const deployed = s.cashDeployedUsd ?? 0;
//         const remaining = Math.max(0, budget - deployed);
//         const stepUsd = Math.min(remaining, buyStepsUsd[k] ?? 0);
//         if (stepUsd <= 0) break;

//         // qty
//         const stepQty = stepUsd / priceNow;
//         if (stepQty < MIN_QTY) break; // занадто мало для біржі

//         // ----- REAL EXEC (SPOT) -----
//         let okxRes: any = undefined;
//         if (EXEC_MODE === "real") {
//           try {
//             const sz = toSz(stepQty);
//             okxRes = await placeSpotOrder({ instId, side: "buy", sz }); // MARKET BUY
//             await logRealOrder({ instId, side: "buy", qty: stepQty, price: priceNow, okxRes, reason: `ladder_buy_step_${k}` });
//           } catch (e) {
//             console.error(`[OKX BUY FAILED] ${instId}`, e);
//             // не валимо ланцюг — просто не виконуємо реальний ордер, але віртуал оновимо
//           }
//         }

//         // ----- ВІРТУАЛЬНЕ ЗАСТОСУВАННЯ -----
//         const prevQty = s.qty ?? 0;
//         const prevAlloc = (s.entryPrice ?? 0) * prevQty;

//         s.qty = prevQty + stepQty;
//         s.cashDeployedUsd = deployed + stepUsd;
//         s.entryPrice = s.qty > 0 ? (prevAlloc + stepUsd) / s.qty : priceNow;

//         if (s.position === "none") s.position = "long";
//         s.enteredAt = s.enteredAt ?? new Date().toISOString();
//         s.lastAction = "buy";
//         s.usedBuySteps = (s.usedBuySteps ?? 0) + 1;
//         s.anchorPrice = s.entryPrice;

//         await appendTrade({
//           instId,
//           time: new Date().toISOString(),
//           type: "buy",
//           price: priceNow,
//           quantity: stepQty,
//           amountUsd: stepUsd,
//           reason: `ladder_buy_step_${k}`,
//           okxOrderId: okxRes?.data?.[0]?.ordId,
//         });

//         needSave = true;

//         if ((s.cashDeployedUsd ?? 0) >= budget) break;
//       }
//     }

//     // --- SELL ladder / timeout ---
//     if (s.position === "long" && (s.entryPrice ?? 0) > 0 && (s.qty ?? 0) > 0) {
//       const nowMs = Date.now();
//       const enteredMs = s.enteredAt ? Date.parse(s.enteredAt) : nowMs;
//       const timeExceeded = nowMs - enteredMs >= maxHold * 60_000;

//       let didCloseAll = false;

//       if (!timeExceeded && sellStepPct > 0) {
//         let ks = s.usedSellSteps ?? 0;
//         while (ks < sellFracs.length) {
//           const tpThreshold = (s.entryPrice as number) * (1 + (ks + 1) * sellStepPct);
//           if (priceNow >= tpThreshold) {
//             const frac = Math.min(1, Math.max(0, sellFracs[ks] ?? 0));
//             if (frac > 0 && (s.qty ?? 0) > 0) {
//               const sellQty = (s.qty as number) * frac;
//               if (sellQty >= MIN_QTY) {
//                 let okxRes: any = undefined;
//                 if (EXEC_MODE === "real") {
//                   try {
//                     const sz = toSz(sellQty);
//                     okxRes = await placeSpotOrder({ instId, side: "sell", sz }); // MARKET SELL
//                     await logRealOrder({ instId, side: "sell", qty: sellQty, price: priceNow, okxRes, reason: `ladder_sell_step_${ks}` });
//                   } catch (e) {
//                     console.error(`[OKX SELL FAILED] ${instId}`, e);
//                   }
//                 }

//                 const realized = (priceNow - (s.entryPrice as number)) * sellQty;
//                 s.qty = Math.max(0, (s.qty as number) - sellQty);
//                 const allocDecrease = (s.entryPrice as number) * sellQty;
//                 s.cashDeployedUsd = Math.max(0, (s.cashDeployedUsd ?? 0) - allocDecrease);

//                 s.pnl += realized;
//                 s.lastAction = "sell";
//                 ks += 1;
//                 s.usedSellSteps = ks;

//                 await appendTrade({
//                   instId,
//                   time: new Date().toISOString(),
//                   type: "sell",
//                   price: priceNow,
//                   quantity: sellQty,
//                   amountUsd: priceNow * sellQty,
//                   pnl: realized,
//                   reason: `ladder_sell_step_${ks - 1}`,
//                   okxOrderId: okxRes?.data?.[0]?.ordId,
//                 });

//                 needSave = true;

//                 if ((s.qty ?? 0) <= 1e-12) {
//                   s.position = "none";
//                   s.entryPrice = null;
//                   s.enteredAt = null;
//                   s.anchorPrice = null;
//                   s.usedBuySteps = 0;
//                   s.usedSellSteps = 0;
//                   await saveState(s);
//                   didCloseAll = true;
//                   break;
//                 }
//               }
//             }
//           } else {
//             break;
//           }
//         }
//       }

//       if (!didCloseAll && timeExceeded) {
//         const sellQty = s.qty as number;
//         if (sellQty >= MIN_QTY) {
//           let okxRes: any = undefined;
//           if (EXEC_MODE === "real") {
//             try {
//               const sz = toSz(sellQty);
//               okxRes = await placeSpotOrder({ instId, side: "sell", sz });
//               await logRealOrder({ instId, side: "sell", qty: sellQty, price: priceNow, okxRes, reason: "timeout_close_all" });
//             } catch (e) {
//               console.error(`[OKX TIMEOUT SELL FAILED] ${instId}`, e);
//             }
//           }

//           const realized = (priceNow - (s.entryPrice as number)) * sellQty;
//           s.pnl += realized;
//           s.lastAction = "sell";
//           s.position = "none";

//           await appendTrade({
//             instId,
//             time: new Date().toISOString(),
//             type: "timeout-sell",
//             price: priceNow,
//             quantity: sellQty,
//             amountUsd: priceNow * sellQty,
//             pnl: realized,
//             reason: "timeout_close_all",
//           });

//           s.qty = 0;
//           s.cashDeployedUsd = 0;
//           s.entryPrice = null;
//           s.enteredAt = null;
//           s.anchorPrice = null;
//           s.usedBuySteps = 0;
//           s.usedSellSteps = 0;

//           await saveState(s);
//           needSave = false;
//         }
//       }
//     }

//     if (needSave) await saveState(s);

//     results.push({
//       instId,
//       currentPrice: priceNow,
//       position: s.position,
//       lastAction: s.lastAction,
//       entryPrice: s.entryPrice,
//       pnl: s.pnl,
//       anchorPrice: s.anchorPrice,
//       qty: s.qty,
//       cashDeployedUsd: s.cashDeployedUsd,
//       usedBuySteps: s.usedBuySteps,
//       usedSellSteps: s.usedSellSteps,

//       mode,
//       buyBelow: strat.buyBelow,
//       sellAbove: strat.sellAbove,
//       buyPctBelow: buyStepPct,
//       sellPctFromEntry: sellStepPct,
//       maxHoldMinutes: maxHold,
//       budgetUsd: budget,
//     });
//   }

//   return results;
// }















// import { getDb } from "@/lib/mongo";
// import { listStrategies, upsertStrategy, VTStrategy } from "@/lib/strategiesRepo";
// import { ObjectId } from "mongodb";

// /** ===== Типи ===== */
// type VTStateDoc = {
//   instId: string;  
//   budgetUsd: number;
//   btc: number;                
//   position: "none" | "long";
//   entryPrice: number | null;
//   enteredAt?: string | null;
//   pnl: number;                  // накопичений PnL у Δціни (поки без глобального qty)
//   updatedAt: string;

//   // НОВЕ — для сходинок:
//   qty?: number;                 // синтетична кількість (сума куплених USD/price)
//   cashDeployedUsd?: number;     // скільки USD вже «задіяно» в позицію
//   usedBuySteps?: number;        // скільки buy-кроків відстріляли
//   usedSellSteps?: number;       // скільки sell-кроків відстріляли

//   anchorPrice?: number | null;  // локальний максимум (коли поза позицією) або entry (коли у позиції)
//   lastAction?: "buy" | "sell" | "hold";
// };

// type VTTradeDoc = {
//   _id: any;
//   instId: string;
//   source: string;
//   ts: string;                 // ISO
//   side: "buy" | "sell" | "hold";
//   price: number;

//   // для прозорості логів сходинок:
//   quantity?: number;
//   amountUsd?: number;
//   reason?: string;

//   pnl?: number;                 // тільки на sell/timeout-sell
//   createdAt: string;
// };

// /** ===== OKX last price ===== */
// async function fetchOkxLast(instId: string): Promise<number> {
//   const r = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`, { cache: "no-store" });
//   const j = await r.json();
//   return parseFloat(j?.data?.[0]?.last ?? "0");
// }

// /** ===== Indexes ===== */
// // let ensured = false;
// // async function ensureIndexes() {
// //   if (ensured) return;
// //   const db = await getDb();
// //   await Promise.all([
// //     db.collection<VTStateDoc>("vt_state").createIndex({ _id: 1 }, { unique: true, name: "_id_unique" }),
// //     db.collection<VTTradeDoc>("vt_tradesan").createIndex({ createdAt: -1 }, { name: "createdAt_desc" }),
// //     db.collection<VTTradeDoc>("vt_tradesan").createIndex({ instId: 1, createdAt: -1 }, { name: "instId_createdAt" }),
// //   ]).catch(() => {});
// //   ensured = true;
// // }

// /** ===== State helpers ===== */
// export async function loadState(instId: string): Promise<VTStateDoc> {
//   // await ensureIndexes();
//   const db = await getDb();
//   const col = db.collection<VTStateDoc>("vt_state");

//   let doc = await col.findOne({ instId: instId });

//   if (!doc) {
//     // дефолтний стан
//     const fresh: VTStateDoc = {
//       instId: instId,
//       budgetUsd: 1000,
//       btc: 0.01,
//       position: "none",
//       entryPrice: null,
//       enteredAt: null,
//       pnl: 0,
//       updatedAt: new Date().toISOString(),
//       qty: 0,
//       cashDeployedUsd: 0,
//       usedBuySteps: 0,
//       usedSellSteps: 0,
//       anchorPrice: null,
//       lastAction: "hold",
//     };

//     await col.updateOne({ instId: instId }, { $set: fresh }, { upsert: true });
//     return fresh;
//   }

//   // backfill полів (на випадок старих документів)
//   const s = doc as VTStateDoc;
//   if (s.qty == null) s.qty = 0;
//   if (s.cashDeployedUsd == null) s.cashDeployedUsd = 0;
//   if (s.usedBuySteps == null) s.usedBuySteps = 0;
//   if (s.usedSellSteps == null) s.usedSellSteps = 0;
//   if (s.lastAction == null) s.lastAction = "hold";

// // console.log(s)

//   return s;
  
// }

// async function saveState(s: VTStateDoc) {
//   const db = await getDb();
//   await db.collection<VTStateDoc>("vt_state").updateOne(
//     { instId: s.instId },
//     { $set: { ...s, updatedAt: new Date().toISOString() } },
//     { upsert: true }
//   );
// }

// async function appendTrade(t: Omit<VTTradeDoc, "_id" | "createdAt">) {
//   const db = await getDb();
//   // const id = `${t.instId}|${t.side}|${Date.parse(t.ts)}`;
//   const id = "BTC-USDT";
//   const doc: VTTradeDoc = { _id: ObjectId, ...t, createdAt: new Date().toISOString() };
//   await db.collection<VTTradeDoc>("vt_tradesan").updateOne({ instId: id }, { $set: doc }, { upsert: true });
// }


// export async function getAllStates(): Promise<VTStateDoc[]> {
//   // await ensureIndexes();
//   const db = await getDb();
//   return db.collection<VTStateDoc>("vt_state").find().toArray();
// }

// /** ===== ГОЛОВНЕ: обхід стратегій з БД ===== */
// export async function checkAllStrategies() {
//   // await ensureIndexes();
//   const strategies = await listStrategies();
// // console.log(strategies)
//   const results: Array<{
//     instId: string;
//     btc: number;
//     currentPrice: number;
//     position: "none" | "long";
//     lastAction?: "buy" | "sell" | "hold";
//     entryPrice: number | null;
//     pnl: number;
//     anchorPrice?: number | null;
//     // інформативно:
//     qty?: number;
//     cashDeployedUsd?: number;
//     usedBuySteps?: number;
//     usedSellSteps?: number;

//     mode: VTStrategy["mode"];
//     buyBelow?: number;
//     sellAbove?: number;
//     buyPctBelow?: number;
//     sellPctFromEntry?: number;
//     maxHoldMinutes?: number;
//     budgetUsd?: number;
//   }> = [];

//   for (const strat of strategies) {
//     const instId = strat.instId;
//     const s = await loadState(instId);
//     const priceNow = await fetchOkxLast(instId);

// // console. log(s)

//     const mode = strat.mode ?? "relative";
//     const maxHold = Math.max(1, strat.maxHoldMinutes ?? 10);
//     const budget = Math.max(1, s.budgetUsd ?? 1000);

//     const buyStepPct = strat.buyPctBelow ?? -0.00015;              
//     const sellStepPct = strat.sellPctFromEntry ?? 0.0003;         
//     const buyStepsUsd = strat.staircaseBuyUsd ?? [0.05,0.1,0.2,0.3,1];
//     const sellFracs = strat.staircaseSellFractions ?? [0.2,0.3,1];

//     /** --- підтримка anchor та lastAction (HOLD) --- */
//     let needSave = false;
//     if (s.position === "none") {
//       const base = s.anchorPrice ?? priceNow;
//       const newAnchor = Math.max(base, priceNow); // ловимо локальні піки коли поза позицією
//       if (newAnchor !== s.anchorPrice) { s.anchorPrice = newAnchor; needSave = true; }
//       if (s.lastAction !== "hold") { s.lastAction = "hold"; needSave = true; }
//     } else {
//       if (!s.anchorPrice && s.entryPrice != null) { s.anchorPrice = s.entryPrice; needSave = true; }
// // console.log(s.anchorPrice, s.entryPrice)
//     }

//     /** --- BUY / LADDER (лише для relative) --- */
//     if (mode === "relative" && buyStepPct < 0) {
//       const anchor = s.anchorPrice ?? priceNow;
//       // спрацьовують усі кроки, для яких ціна нижча за anchor*(1 - (k+1)*buyStepPct)
//       while (
//         s.position === "long" || s.position === "none" // дозволяємо входити, коли поза позицією — стане long після першого кроку
//       ) {
//         let k = s.usedBuySteps ?? 0;
//         if (k >= buyStepsUsd.length)  break;

//         const requiredDrop = (k + 1) * buyStepPct;
//         const buyThreshold = anchor * (1 - requiredDrop);

//         if (!(priceNow <= buyThreshold)) break;

//         // перевіряємо бюджет
//         const deployed = s.cashDeployedUsd ?? 0;
//         const remaining = Math.max(0, budget - deployed);
//         const stepUsdRaw = buyStepsUsd[k]  ?? 0;
//         const stepUsd = remaining * stepUsdRaw;
// console.log("stepUsd: " , stepUsd)
//         if (stepUsd <= 0) break;

//         // виконуємо BUY-крок
//         const stepQty = stepUsd / priceNow;
//         const prevQty = s.qty ?? 0;
//         const prevAlloc = (s.entryPrice ?? 0) * prevQty;

//         s.qty = prevQty + stepQty;
//         s.cashDeployedUsd = deployed + stepUsd;
//         s.entryPrice = s.qty > 0 ? (prevAlloc + stepUsd) / s.qty : priceNow;
//         s.pnl = remaining + (s.qty * priceNow) - 2150
//         // якщо були «поза позицією» — тепер позиція LONG
//         if (s.position === "none") s.position = "long";
//         s.enteredAt = s.enteredAt ?? new Date().toISOString();
//         s.lastAction = "buy";
//         s.usedBuySteps = (s.usedBuySteps ?? 0) + 1;
//         s.anchorPrice = s.entryPrice; 
//         s.budgetUsd = remaining - stepUsd;

//         await appendTrade({
//           instId,
//           source: "vt_tradesan",
//           ts: new Date().toISOString(),
//           side: "buy",
//           price: priceNow,
//           pnl: s.pnl,
//           quantity: stepQty,
//           amountUsd: stepUsd,
//           reason: `ladder_buy_step_${k}`,
//         });

//         needSave = true;

//         // якщо вичерпали бюджет — стоп
//         if ((s.cashDeployedUsd ?? 0) >= budget) break;
//         // цикл продовжує перевірку на випадок, якщо ціна вже «пробила» кілька рівнів одразу
//       }
//     }

//     /** --- SELL / TP / LADDER / timeout --- */
//     if (s.position === "long" && (s.entryPrice ?? 0) > 0 && (s.qty ?? 0) > 0) {
//       // const nowMs = Date.now();
//       // const enteredMs = s.enteredAt ? Date.parse(s.enteredAt) : nowMs;
//       // const timeExceeded = nowMs - enteredMs >= maxHold * 60_000;

//       let didSell = false;

//       // спроба відпрацювати сходинки TP (relative)
//       if (sellStepPct > 0) {
//         // скільки кроків вже виконано
//         let ks = s.usedSellSteps ?? 0;

//         // може спрацювати одразу кілька кроків
//         while (ks <= sellFracs.length) {
//           const tpThreshold = (s.entryPrice as number) * (1 + (ks + 1) * sellStepPct);
//           if (priceNow >= tpThreshold) {
//             const frac = Math.min(1, Math.max(0, sellFracs[ks] ?? 0));
//             if (frac > 0 && (s.qty ?? 0) > 0) {
//               s.pnl = s.budgetUsd + ((s.qty as number) * priceNow) - 2150
//               const sellQty = (s.qty as number) * frac;
//               // const realized = (priceNow - (s.entryPrice as number)) * sellQty;
//               // зменшуємо позицію пропорційно
//               s.qty = Math.max(0, (s.qty as number) - sellQty);
//               const allocDecrease = (s.entryPrice as number) * sellQty;
//               s.cashDeployedUsd = Math.max(0, (s.cashDeployedUsd ?? 0) - allocDecrease);
//               s.lastAction = "sell";
//               ks += 1;
//               s.usedSellSteps = ks;

//               s.enteredAt = s.enteredAt ?? new Date().toISOString();
//               s.anchorPrice = s.entryPrice; 

//               await appendTrade({
//                 instId,
//                 source: "vt_tradesan",
//                 ts: new Date().toISOString(),
//                 side: "sell",
//                 price: priceNow,
//                 quantity: sellQty,
//                 amountUsd: priceNow * sellQty,
//                 pnl: s.pnl,
//                 reason: `ladder_sell_step_${ks - 1}`,
//               });

//               needSave = true;

//               // якщо все розпродали — завершуємо
//               if ((s.qty ?? 0) <= 1e-12) {
//                 s.position = "none";
//                 s.entryPrice = null;
//                 s.enteredAt = null;
//                 s.anchorPrice = null;
//                 s.usedBuySteps = 0;
//                 s.usedSellSteps = 0;
//                 await saveState(s);
//                 didSell = true;
//                 break;
//               }
//             } else {
//               break;
//             }
//           } else {
//             break;
//           }
//         }
//       }

//       // timeout — закриваємо повністю
//       if (!didSell) {
//         const sellQty = s.qty as number;
//         // const realized = (priceNow - (s.entryPrice as number)) * sellQty;
//         const sum = s.budgetUsd + (priceNow * (s.qty as number)) - 2150  
//         s.pnl = sum;
//         s.lastAction = "sell";
//         s.position = "none";

//         await appendTrade({
//           instId,
//           source: "vt_tradesan",
//           ts: new Date().toISOString(),
//           side: "hold",
//           price: priceNow,
//           quantity: sellQty,
//           amountUsd: priceNow * sellQty,
//           pnl: sum,
//           reason: "timeout_close_all",
//         });

//         // скидання стану
//         s.qty = 0;
//         s.cashDeployedUsd = 0;
//         s.entryPrice = null;
//         s.enteredAt = null;
//         s.anchorPrice = null;
//         s.usedBuySteps = 0;
//         s.usedSellSteps = 0;

//         await saveState(s);
//         needSave = false;
//       }
//     }

//     if (needSave) {
//       await saveState(s);
//     }

//     results.push({
//       instId,
//       btc: (s.qty as number),
//       currentPrice: priceNow,
//       position: s.position,
//       lastAction: s.lastAction,
//       entryPrice: s.entryPrice,
//       pnl: s.pnl,
//       anchorPrice: s.anchorPrice,

//       qty: s.qty,
//       cashDeployedUsd: s.cashDeployedUsd,
//       usedBuySteps: s.usedBuySteps,
//       usedSellSteps: s.usedSellSteps,

//       mode,
//       buyBelow: strat.buyBelow,
//       sellAbove: strat.sellAbove,
//       buyPctBelow: buyStepPct,
//       sellPctFromEntry: sellStepPct,
//       maxHoldMinutes: maxHold,
//       budgetUsd: budget,
//     });
//   }

//   return results;
// }
