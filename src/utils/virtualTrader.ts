import { getDb } from "@/lib/mongo";
import { listStrategies, VTStrategy } from "@/lib/strategiesRepo";

// ---- Типи стану/трейду ----
type VTStateDoc = {
  _id: string;                 // instId
  position: "none" | "long";
  entryPrice: number | null;
  enteredAt?: string | null;   // коли увійшли
  pnl: number;                 // накопичений PnL $
  updatedAt: string;
};

type VTTradeDoc = {
  _id: string;                 // <instId>|<type>|<ts>
  instId: string;
  time: string;                // ISO
  type: "buy" | "sell" | "timeout-sell";
  price: number;
  pnl?: number;
  createdAt: string;
};

// ---- OKX price ----
async function fetchOkxLast(instId: string): Promise<number> {
  const r = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`, { cache: "no-store" });
  const j = await r.json();
  return parseFloat(j?.data?.[0]?.last ?? "0");
}

// ---- Indexes ----
let ensured = false;
async function ensureIndexes() {
  if (ensured) return;
  const db = await getDb();
  await Promise.all([
    db.collection<VTStateDoc>("vt_state").createIndex({ _id: 1 }, { unique: true, name: "_id_unique" }),
    db.collection<VTTradeDoc>("vt_trades").createIndex({ createdAt: -1 }, { name: "createdAt_desc" }),
    db.collection<VTTradeDoc>("vt_trades").createIndex({ instId: 1, createdAt: -1 }, { name: "instId_createdAt" }),
  ]).catch(()=>{});
  ensured = true;
}

// ---- State helpers ----
async function loadState(instId: string): Promise<VTStateDoc> {
  await ensureIndexes();
  const db = await getDb();
  const col = db.collection<VTStateDoc>("vt_state");
  return (
    (await col.findOne({ _id: instId })) ?? {
      _id: instId,
      position: "none",
      entryPrice: null,
      enteredAt: null,
      pnl: 0,
      updatedAt: new Date().toISOString(),
    }
  );
}
async function saveState(s: VTStateDoc) {
  const db = await getDb();
  await db.collection<VTStateDoc>("vt_state").updateOne(
    { _id: s._id },
    { $set: { ...s, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
}
async function appendTrade(t: Omit<VTTradeDoc,"_id"|"createdAt">) {
  const db = await getDb();
  const id = `${t.instId}|${t.type}|${Date.parse(t.time)}`;
  const doc: VTTradeDoc = { _id:id, ...t, createdAt: new Date().toISOString() };
  await db.collection<VTTradeDoc>("vt_trades").updateOne({ _id:id }, { $set: doc }, { upsert:true });
}

// ---- Публічні читачі (як були) ----
export async function getTradeHistory(limit = 100, instId?: string): Promise<VTTradeDoc[]> {
  await ensureIndexes();
  const db = await getDb();
  const filter = instId ? { instId } : {};
  return db.collection<VTTradeDoc>("vt_trades").find(filter).sort({ createdAt: -1 }).limit(Math.min(limit, 2000)).toArray();
}
export async function getAllStates(): Promise<VTStateDoc[]> {
  await ensureIndexes();
  const db = await getDb();
  return db.collection<VTStateDoc>("vt_state").find({}).toArray();
}

// ---- ГОЛОВНЕ: обхід стратегій з БД ----
export async function checkAllStrategies() {
  await ensureIndexes();
  const strategies = await listStrategies();

  const results: Array<{
    instId: string;
    currentPrice: number;
    position: "none" | "long";
    entryPrice: number | null;
    pnl: number;
    mode: VTStrategy["mode"];
    buyBelow?: number;
    sellAbove?: number;
    buyPctBelow?: number;
    sellPctFromEntry?: number;
    maxHoldMinutes?: number;
  }> = [];

  for (const strat of strategies) {
    const instId = strat.instId;
    const s = await loadState(instId);
    const priceNow = await fetchOkxLast(instId);
    const mode = strat.mode ?? "relative";
    const maxHold = Math.max(1, strat.maxHoldMinutes ?? 10);

    // Обчислюємо пороги
    // BUY:
    let buyTrigger = Number.POSITIVE_INFINITY;
    if (mode === "absolute" && strat.buyBelow != null) {
      buyTrigger = strat.buyBelow;
    } else if (mode === "relative" && strat.buyPctBelow != null) {
      buyTrigger = priceNow * (1 - strat.buyPctBelow);
    }

    // SELL / TP:
    // для relative — від входу (entry * (1 + sellPctFromEntry))
    let sellTrigger = Number.NEGATIVE_INFINITY;
    if (mode === "absolute" && strat.sellAbove != null) {
      sellTrigger = strat.sellAbove;
    } else if (mode === "relative" && strat.sellPctFromEntry != null && s.entryPrice != null) {
      sellTrigger = s.entryPrice * (1 + strat.sellPctFromEntry);
    }

    // ---- BUY умова ----
    if (s.position === "none" && priceNow > 0 && priceNow <= buyTrigger) {
      s.position = "long";
      s.entryPrice = priceNow;
      s.enteredAt = new Date().toISOString();
      await appendTrade({ instId, time: new Date().toISOString(), type: "buy", price: priceNow });
      await saveState(s);
    }

    // ---- SELL / TP / timeout ----
    if (s.position === "long" && s.entryPrice != null) {
      const nowMs = Date.now();
      const enteredMs = s.enteredAt ? Date.parse(s.enteredAt) : nowMs;

      const reachedTp = priceNow >= sellTrigger && Number.isFinite(sellTrigger);
      const timeExceeded = nowMs - enteredMs >= maxHold * 60_000;

      if (reachedTp || timeExceeded) {
        const pnl = priceNow - s.entryPrice;
        s.pnl += pnl;
        s.position = "none";
        const type = reachedTp ? "sell" : "timeout-sell";
        await appendTrade({ instId, time: new Date().toISOString(), type, price: priceNow, pnl });
        s.entryPrice = null;
        s.enteredAt = null;
        await saveState(s);
      }
    }

    results.push({
      instId,
      currentPrice: priceNow,
      position: s.position,
      entryPrice: s.entryPrice,
      pnl: s.pnl,
      mode,
      buyBelow: strat.buyBelow,
      sellAbove: strat.sellAbove,
      buyPctBelow: strat.buyPctBelow,
      sellPctFromEntry: strat.sellPctFromEntry,
      maxHoldMinutes: maxHold,
    });
  }

  return results;
}
