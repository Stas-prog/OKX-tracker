import { getDb } from "@/lib/mongo";


type VTStateDoc = {
  instId: string;  
  budgetUsd: number;
  budgetBtc: number; 
  updatedAt: string;               
};

let ensured = false;
async function ensureIndexes() {
  if (ensured) return;
  const db = await getDb();
  await Promise.all([
    db.collection<VTStateDoc>("vt_state").createIndex({ instId: 1 }, { name: "instId_1", unique: true }),]);
//   db.collection.<VTStateDoc>("vt_state")createIndex({ _id: 1 }, { name: "_id_1" }); 
  ensured = true;
}

export async function loadState(instId: string): Promise<VTStateDoc> {
  await ensureIndexes();
  const db = await getDb();
  const col = db.collection<VTStateDoc>("vt_state");

  let doc = await col.findOne({ instId });

  if (!doc) {
    // дефолтний стан
    const fresh: VTStateDoc = {
      instId: instId,
      budgetUsd: 1000,
      budgetBtc: 0.01,
      updatedAt: new Date().toISOString(),  
    };

    await col.updateOne({instId}, { $set: fresh, updatedAt: new Date().toISOString }, { upsert: true });
    return fresh;
  }
    const s = doc as VTStateDoc;
 
    return s; 
}

export async function saveState(s: VTStateDoc): Promise<void> {
  const db = await getDb();
  await db.collection<VTStateDoc>("vt_state").updateOne(
    { instId: s.instId},
    { $set: { ...s, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
}
loadState("BTC-USDT").then((s) => console.log("Loaded state:", s));