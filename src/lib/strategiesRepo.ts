import { getDb } from "@/lib/mongo";

/** Формат однієї стратегії в БД */
export type VTStrategy = {
  _id: string;                
  instId: string;              
  mode?: "absolute" | "relative"; 
  // absolute:
  buyBelow?: number;           
  sellAbove?: number;          
  // relative:
  buyPctBelow?: number;     
  sellPctFromEntry?: number;   
  // спільне:
  maxHoldMinutes?: number;     
  updatedAt?: string;
};

export async function ensureStrategyIndexes() {
  const db = await getDb();
  await db.collection<VTStrategy>("vt_strategies")
    .createIndex({ _id: 1 }, { unique: true, name: "_id_unique" })
    .catch(()=>{});
}

export async function listStrategies(): Promise<VTStrategy[]> {
  await ensureStrategyIndexes();
  const db = await getDb();
  return db.collection<VTStrategy>("vt_strategies").find({}).toArray();
}

export async function upsertStrategy(s: VTStrategy) {
  await ensureStrategyIndexes();
  const now = new Date().toISOString();
  const doc: VTStrategy = {
    _id: s.instId,
    instId: s.instId,
    mode: s.mode ?? "relative",
    buyBelow: s.buyBelow,
    sellAbove: s.sellAbove,
    buyPctBelow: s.buyPctBelow,
    sellPctFromEntry: s.sellPctFromEntry,
    maxHoldMinutes: s.maxHoldMinutes ?? 10,
    updatedAt: now,
  };
  const db = await getDb();
  await db.collection<VTStrategy>("vt_strategies").updateOne(
    { _id: doc._id },
    { $set: doc },
    { upsert: true }
  );
  return doc;
}

export async function deleteStrategy(instId: string) {
  const db = await getDb();
  await db.collection<VTStrategy>("vt_strategies").deleteOne({ _id: instId });
}
