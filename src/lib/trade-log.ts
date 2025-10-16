import type { Db, Document } from "mongodb";

export type TradeDoc = {
  _id?: any;
  source: "trades" | "vt_trades" | "multi_trades";
  instId: string;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  amountUsd?: number;
  reason?: string;
  id?: string;        // біржовий/симуляційний id
  ts?: string;        // час ордеру
  createdAt?: string; // час запису
};

// Запис у конкретну колекцію (за замовчуванням 'trades')
export async function addTrade(db: Db, doc: TradeDoc, collection = "trades") {
  const coll = db.collection(collection);
  const toInsert: TradeDoc = {
    ...doc,
    source: (collection as TradeDoc["source"]) ?? "trades",
    createdAt: doc.createdAt ?? new Date().toISOString(),
    ts: doc.ts ?? new Date().toISOString(),
  };
  await coll.insertOne(toInsert as Document);
  return toInsert;
}

// Об’єднане читання з trades + vt_trades + multi_trades
export async function getTradeHistory(db: Db, limit = 100) {
  const baseProject = {
    _id: 1, instId: 1, side: 1, price: 1, quantity: 1, amountUsd: 1, reason: 1, id: 1, ts: 1, createdAt: 1,
  };

  const pipe: Document[] = [
    { $project: { ...baseProject, source: { $literal: "trades" } } },
    { $unionWith: {
        coll: "vt_trades",
        pipeline: [{ $project: { ...baseProject, source: { $literal: "vt_trades" } } }]
      }
    },
    { $unionWith: {
        coll: "multi_trades",
        pipeline: [{ $project: { ...baseProject, source: { $literal: "multi_trades" } } }]
      }
    },
    { $addFields: {
        sortTs: {
          $ifNull: [
            { $toDate: "$ts" },
            { $ifNull: [ { $toDate: "$createdAt" }, new Date(0) ] }
          ]
        }
      }
    },
    { $sort: { sortTs: -1, _id: -1 } },
    { $limit: limit },
  ];

  const cursor = db.collection("trades").aggregate(pipe);
  const rows = await cursor.toArray();
  return rows;
}


