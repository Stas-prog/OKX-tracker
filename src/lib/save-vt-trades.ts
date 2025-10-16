import type { Db } from "mongodb";

export async function saveVtTrades(db: Db, trades: any[]) {
  if (!trades?.length) return;
  try {
    const docs = trades.map(t => ({ ...t, createdAt: new Date().toISOString() }));
    const res = await db.collection("vt_trades").insertMany(docs);
    if (!res?.insertedCount) console.error("vt_trades insertMany returned 0");
  } catch (e) {
    console.error("vt_trades insert error:", e);
  }
}
