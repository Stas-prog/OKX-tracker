
import type { Db } from "mongodb";

type InstId = string;
type StairStep = { pctDrop: number; amountPct: number };
export type MultiStrategy = {
  id?: string;
  name: string;
  instIds: InstId[];
  baseAllocationPct?: number;
  maxAllocationPct?: number;
  staircase?: StairStep[];
  stopLossPct?: number;
  takeProfitPct?: number;
  rebalanceIntervalSec?: number;
};

type PricePoint = { instId: InstId; price: number; ts?: string; };

export type Order = {
  id?: string;
  instId: InstId;
  side: "buy" | "sell";
  price: number;
  prevPrice?: number;
  amountUsd: number;
  quantity: number;
  reason?: string;
  ts?: string;
};

const nowIso = () => new Date().toISOString();
const clamp = (v:number,a:number,b:number) => Math.max(a, Math.min(b, v));

async function defaultGetDb(): Promise<Db> {
  throw new Error("MultiTrader: please provide getDb() implementation when constructing.");
}

export class MultiTrader {
  strategy: MultiStrategy;
  state: any;
  getDb: () => Promise<Db>;
  executeOrderFn?: (order: Order) => Promise<Order>;

  constructor(opts: {
    strategy: MultiStrategy;
    capitalUsd: number;
    getDb?: () => Promise<Db>;
    executeOrderFn?: (order: Order) => Promise<Order>;
  }) {
    this.strategy = {
      baseAllocationPct: 0.2,
      maxAllocationPct: 0.5,
      staircase: [ 
        { pctDrop: 0.005, amountPct: 0.05 }, // 0.5%
        { pctDrop: 0.01,  amountPct: 0.05 } 
 ],
      stopLossPct: 0.01,
      takeProfitPct: 0.01,
      rebalanceIntervalSec: 3600,
      ...opts.strategy,
    };
    const instIds = (this.strategy.instIds || []).slice(0,5);
    this.state = {
      capitalUsd: opts.capitalUsd,
      cashUsd: opts.capitalUsd,
      instStates: instIds.map((id) => ({
        instId: id,
        allocatedUsd: 0,
        quantity: 0,
        avgEntryPrice: 0,
        staircaseUsed: {},
        history: [] as number[], 
      })),
      updatedAt: nowIso(),
      strategyId: this.strategy.id ?? this.strategy.name ?? "multi-default",
    };
    this.getDb = opts.getDb ?? defaultGetDb;
    this.executeOrderFn = opts.executeOrderFn;
  }

  // Initialize equal allocation
  async initializePortfolio(prices: PricePoint[]) {
    const basePct = this.strategy.baseAllocationPct ?? 0.2;
    for (const inst of this.state.instStates) {
      const price = prices.find(p => p.instId === inst.instId)?.price;
      if (!price) continue;
      const amountUsd = this.state.capitalUsd * basePct;
      const qty = amountUsd / price;
      const ord: Order = { instId: inst.instId, side: "buy", price, amountUsd, quantity: qty, reason: "initial_allocation", ts: nowIso() };
      await this._execute(ord);
      inst.allocatedUsd += amountUsd;
      inst.quantity += qty;
      inst.avgEntryPrice = inst.quantity ? (inst.allocatedUsd / inst.quantity) : price;
      this.state.cashUsd = clamp(this.state.cashUsd - amountUsd, 0, this.state.capitalUsd);
    }
    // refresh prevPrice for the next tick
for (const inst of this.state.instStates) {
  const p = prices.find(x => x.instId === inst.instId)?.price;
  if (p) (inst as any).prevPrice = p;
}

    this.state.updatedAt = nowIso();
    await this.saveState();
  }

  // Main tick: prices from market
  async onTick(prices: PricePoint[]) {
    const orders: Order[] = [];

    // init prevPrice one-time per instrument (for momentum)
   for (const inst of this.state.instStates) {
  const p = prices.find(x => x.instId === inst.instId)?.price;
  if (!p) continue;
  // prevPrice init
  if ((inst as any).prevPrice == null) (inst as any).prevPrice = p;
  // history (rolling window 20)
  inst.history = Array.isArray(inst.history) ? inst.history : [];
  inst.history.push(p);
  if (inst.history.length > 20) inst.history.shift();
}



    // 1) take profit / stop loss checks
    for (const inst of this.state.instStates) {
      const p = prices.find(x => x.instId === inst.instId);
      if (!p) continue;
      const price = p.price;
      if (inst.quantity > 0 && inst.avgEntryPrice > 0) {
        const pnlPct = (price - inst.avgEntryPrice)/inst.avgEntryPrice;
        if ((this.strategy.takeProfitPct ?? 0.08) > 0 && pnlPct >= (this.strategy.takeProfitPct ?? 0.08)) {
          orders.push({ instId: inst.instId, side: "sell", price, amountUsd: inst.allocatedUsd * 0.5, quantity: (inst.allocatedUsd * 0.5) / price, reason: "take_profit_partial", ts: nowIso() });
        }
        if ((this.strategy.stopLossPct ?? 0.15) > 0 && pnlPct <= -(this.strategy.stopLossPct ?? 0.15)) {
          orders.push({ instId: inst.instId, side: "sell", price, amountUsd: inst.allocatedUsd, quantity: inst.allocatedUsd/price, reason: "stop_loss_exit", ts: nowIso() });
        }
      }
    }

    // 2) staircase buys
    for (const inst of this.state.instStates) {
      const p = prices.find(x => x.instId === inst.instId);
      if (!p) continue;
      const price = p.price;
      const ref = (inst.avgEntryPrice && inst.avgEntryPrice>0) ? inst.avgEntryPrice : price;
      const steps = this.strategy.staircase || [];
      for (let i=0;i<steps.length;i++){
        if (inst.staircaseUsed && inst.staircaseUsed[i]) continue;
        const step = steps[i];
        const drop = (ref - price)/ref;
        if (drop >= step.pctDrop) {
          const baseAlloc = (this.strategy.baseAllocationPct ?? 0.2) * this.state.capitalUsd;
          const buyUsd = baseAlloc * step.amountPct;
          if (this.state.cashUsd >= buyUsd && buyUsd>0) {
            orders.push({ instId: inst.instId, side: "buy", price, amountUsd: buyUsd, quantity: buyUsd/price, reason: `staircase_buy_step_${i}`, ts: nowIso() });
          }
        }
      }
    }

    // 2.5) SMA сигнали (дають природні дрібні трейди)
for (const inst of this.state.instStates) {
  const p = prices.find(x => x.instId === inst.instId)?.price;
  if (!p) continue;
  const h = (inst.history || []) as number[];
  if (h.length >= 5) {
    const sma = h.slice(-5).reduce((a,b)=>a+b,0) / 5;
    const dev = (p - sma) / sma; // відхилення від середнього

    // якщо ціна нижча за SMA на 0.3% — докупимо на 2% від капіталу (за наявності кешу)
    if (dev <= -0.003) {
      const buyUsd = this.state.capitalUsd * 0.02;
      if (this.state.cashUsd >= buyUsd && buyUsd > 0) {
        orders.push({
          instId: inst.instId,
          side: "buy",
          price: p,
          amountUsd: buyUsd,
          quantity: buyUsd / p,
          reason: "sma_mean_revert_buy",
          ts: nowIso(),
        });
      }
    }

    // якщо ціна вища за SMA на 0.3% і є позиція — частково зафіксувати 2%
    if (dev >= 0.003 && inst.allocatedUsd > 0) {
      const sellUsd = Math.min(inst.allocatedUsd * 0.1, this.state.capitalUsd * 0.02);
      if (sellUsd > 0) {
        orders.push({
          instId: inst.instId,
          side: "sell",
          price: p,
          amountUsd: sellUsd,
          quantity: sellUsd / p,
          reason: "sma_mean_revert_sell",
          ts: nowIso(),
        });
      }
    }
  }
}


    // 3) naive momentum stub: (real implementation should use EMA/RSI)
    const momentumScores = await this.evaluateMomentum(prices);
    const sorted = Object.entries(momentumScores).sort((a,b)=>b[1]-a[1]);
    if (sorted.length>0 && sorted[0][1] > 0.003) {
      const top = sorted[0][0];
      // reallocate small amount from weakest
      const topState = this.state.instStates.find((s:{instId:string})=>s.instId===top);
      const currentPct = topState ? topState.allocatedUsd / this.state.capitalUsd : 0;
      const maxPct = this.strategy.maxAllocationPct ?? 0.5;
      const targetAddPct = Math.min(0.03, maxPct - currentPct);
      if (targetAddPct > 0) {
        let needUsd = this.state.capitalUsd * targetAddPct;
    const weakest = [...this.state.instStates].sort(
      (a: any, b: any) => (momentumScores[a.instId] || 0) - (momentumScores[b.instId] || 0));
        for (const w of weakest) {
          if (w.instId === top) continue;
          const avail = Math.min(w.allocatedUsd * 0.5, needUsd);
          if (avail <= 0) continue;
          orders.push({ instId: w.instId, side: "sell", price: prices.find(p=>p.instId===w.instId)?.price||0, amountUsd: avail, quantity: (prices.find(p=>p.instId===w.instId)?.price||1) ? avail / (prices.find(p=>p.instId===w.instId)!.price) : 0, reason:`reallocate_to_${top}`, ts: nowIso() });
          orders.push({ instId: top, side: "buy", price: prices.find(p=>p.instId===top)?.price||0, amountUsd: avail, quantity: (prices.find(p=>p.instId===top)?.price||1) ? avail / (prices.find(p=>p.instId===top)!.price) : 0, reason:`reallocate_from_${w.instId}`, ts: nowIso() });
          needUsd -= avail;
          if (needUsd <= 0) break;
        }
      }
    }

    // Execute orders sequentially
    const executed: Order[] = [];
    for (const o of orders) {
      const r = await this._execute(o);
      executed.push(r);
      await this._applyOrderToState(r);
    }

    // refresh prevPrice for the next tick
for (const inst of this.state.instStates) {
  const p = prices.find(x => x.instId === inst.instId)?.price;
  if (p) (inst as any).prevPrice = p;
}


    this.state.updatedAt = nowIso();
    await this.saveState();
    await this._saveTrades(executed);
    return { orders: executed };
  }

  // placeholder: compute momentum; replace with real indicators
 async evaluateMomentum(prices: PricePoint[]): Promise<Record<InstId, number>> {
  const out: Record<InstId, number> = {};
  for (const s of this.state.instStates) {
    const p = prices.find(pp => pp.instId === s.instId)?.price;
    const prev = (s as any).prevPrice;
    out[s.instId] = (p && prev) ? (p - prev) / prev : 0; // відносна зміна з останнього тіку
  }
  return out;
}



  private async _execute(order: Order): Promise<Order> {
    const ord = { ...order, ts: order.ts ?? nowIso() };
    if (this.executeOrderFn) {
      try {
        const res = await this.executeOrderFn(ord);
        return { ...ord, ...res, ts: nowIso() };
      } catch (e) {
        console.error("executeOrderFn failed", e);
      }
    }
    return { ...ord, id: `sim-${Date.now()}`, ts: nowIso() };
  }

  private async _applyOrderToState(ord: Order) {
    const inst = this.state.instStates.find((s:any)=>s.instId === ord.instId);
    if (!inst) return;
    if (ord.side === "buy") {
      inst.allocatedUsd = (inst.allocatedUsd||0) + ord.amountUsd;
      const added = ord.quantity;
      const prevQty = inst.quantity || 0;
      const prevAlloc = prevQty * (inst.avgEntryPrice || 0);
      const totalQty = prevQty + added;
      inst.avgEntryPrice = totalQty>0 ? (prevAlloc + ord.amountUsd)/totalQty : ord.price;
      inst.quantity = totalQty;
      inst.lastBuyTimestamp = nowIso();
      const m = ord.reason?.match(/staircase_buy_step_(\d+)/);
      if (m) inst.staircaseUsed = { ...(inst.staircaseUsed||{}), [parseInt(m[1],10)]: true };
      this.state.cashUsd = clamp(this.state.cashUsd - ord.amountUsd, 0, this.state.capitalUsd);
    } else {
      const sold = ord.amountUsd;
      inst.quantity = Math.max(0, (inst.quantity||0) - ord.quantity);
      inst.allocatedUsd = Math.max(0, (inst.allocatedUsd||0) - sold);
      if (inst.quantity === 0) inst.avgEntryPrice = 0;
      inst.lastSellTimestamp = nowIso();
      this.state.cashUsd = clamp(this.state.cashUsd + sold, 0, this.state.capitalUsd);
    }
  }

  async saveState() {
    const db = await this.getDb();
    const coll = db.collection("multi_state");
    const q = { strategyId: this.state.strategyId || this.strategy.id || this.strategy.name || "multi-default" };
    await coll.updateOne(q, { $set: { ...this.state, updatedAt: nowIso() } }, { upsert: true });
  }

  async loadState() {
    const db = await this.getDb();
    const coll = db.collection("multi_state");
    const doc = await coll.findOne({ strategyId: this.state.strategyId || this.strategy.id || this.strategy.name || "multi-default" });
    if (doc) this.state = { ...this.state, ...(doc as any) };
    return this.state;
  }

  async _saveTrades(trades: Order[]) {
    if (!trades || trades.length === 0) return;
    const db = await this.getDb();
    const coll = db.collection("multi_trades");
    const docs = trades.map(t => ({...t, createdAt: nowIso()}));
    await coll.insertMany(docs);
  }
}
