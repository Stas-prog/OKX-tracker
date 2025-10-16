import { NextResponse } from "next/server";
import { getBtcUsdtPrice } from "@/lib/okxClient";
import { getWallet, updateWallet, getLastTxn } from "@/lib/simulatorWallet";
import { getDb } from "@/lib/mongo";

type VtTrade = {
  pnl?: number;
  source: string;
  instId: string;
  side: "buy" | "sell" | "hold";
  position: "none" | "long"
  price: number;
  quantity: number;
  amountUsd: number;
  reason: string;
  id: any;
  ts: string; 
  createdAt: string
};

export async function GET() {
  try {
    const price = await getBtcUsdtPrice();
    const action = updateWallet(price); 
    const wallet = getWallet();
    
    const last = getLastTxn();
    if (last) {

      const db = await getDb();

      const s: VtTrade = {
        source: "vt_tradesan",
        instId: last.instId,
        side: last.side,
        pnl: last.pnl,
        price: last.price,
        position: last.position,
        quantity: last.quantity,
        amountUsd: last.amountUsd,
        reason: "virtual_trader_tick",
        id: `vt-${Date.now()}`,
        ts: last.ts,
        createdAt: new Date().toISOString(),
      }

      await db.collection<VtTrade>("vt_tradesan").updateOne(
    { instId: s.instId},
    { $set: { ...s, updatedAt: new Date().toISOString() } },
    { upsert: true }
      );
    console.log("Document apdated successfully");

    }


    
    return NextResponse.json({
      ok: true,
      instId: last?.instId || "BTC_USDT",
      action,
      wallet: { usdt: wallet.usdt, btc: wallet.btc, lastPrice: wallet.lastPrice, side: wallet.side, position: wallet.position, pnl: wallet.pnl },
      price,
    });
  } catch (error) {
    console.error("❌ /api/trade error:", error);
    return NextResponse.json({ ok: false, message: "Щось пішло не так" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
     
     const last = getLastTxn();

    if (last) {
    const query = { del: last.del - 1 }; 
    const db = await getDb();
    const col = db.collection<VtTrade>("vt_tradesan")
    await col.deleteOne(query);
  }

   
    console.log("Document deleted successfully");
   } catch (error) {
    console.error("❌ /api/trade error:", error);
    return NextResponse.json({ ok: false, message: "Щось пішло не так, документ не видалено" }, { status: 500 });
  }
}


//   await db.collection<VtTrade>("vt_tradesan").insertOne({
    //     source: "vt_tradesan",
    //     instId: last.instId,
    //     side: last.side,
    //     del: last.del,
    //     pnl: last.pnl,
    //     price: last.price,
    //     position: last.position,
    //     quantity: last.quantity,
    //     amountUsd: last.amountUsd,
    //     reason: "virtual_trader_tick",
    //     id: `vt-${Date.now()}`,
    //     ts: last.ts,
    //     createdAt: new Date().toISOString(),
    //   });
    //  Delete()

