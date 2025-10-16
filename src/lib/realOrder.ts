import { getDb } from "./mongo";

type RealOrderRow = {
  instId: string;
  side: "buy" | "sell"; 
  qty: number;
  price: number;
  okxRes?: any;
};



export async function logRealOrder(row: {
  instId: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  okxRes?: any;
}) {
  try {
    const db = await getDb();
    
    await db.collection<RealOrderRow>("okx_real_trades").updateOne(
    { instId: row.instId},
    { $set: { ...row, updatedAt: new Date().toISOString() } },
    { upsert: true }
  );
  } catch (e) {
    console.error("logRealOrder failed:", e);
  }
}




// await db.collection("okx_real_trades").insertOne({
    //   instId: row.instId,
    //   side: row.side,
    //   qty: row.qty,
    //   price: row.price,
    //   okx: row.okxRes,
    //   createdAt: new Date().toISOString(),
    // });