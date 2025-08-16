import { getDb } from "@/lib/mongo";

export type TradeAction = {
    time: string;        // ISO або локальний час — покажемо як є
    action: string;      // "BUY" | "SELL" | текст для віртуального бота
    price: number;
    instId?: string;     // напр. "BTC-USDT"
    createdAt?: string;  // ISO для сорту/фільтрів
};

const COL = "mini_trades";

/** Додає запис у Mongo (read-only для клієнта). */
export async function addTrade(action: TradeAction) {
    const db = await getDb();
    const doc: TradeAction = {
        ...action,
        createdAt: action.createdAt || new Date().toISOString(),
    };
    await db.collection<TradeAction>(COL).insertOne(doc as any);
}

/** Повертає історію з параметрами (за замовчуванням останні 50, нові згори). */
export async function getTradeHistory(params?: {
    limit?: number;
    since?: string;   // createdAt > since
    before?: string;  // createdAt < before
    order?: "asc" | "desc";
}) {
    const limit = Math.min(params?.limit ?? 50, 2000);
    const order = (params?.order ?? "desc") === "asc" ? 1 : -1;

    const filter: any = {};
    if (params?.since || params?.before) {
        filter.createdAt = {};
        if (params.since) filter.createdAt.$gt = params.since;
        if (params.before) filter.createdAt.$lt = params.before;
    }

    const db = await getDb();
    const rows = await db
        .collection<TradeAction>(COL)
        .find(filter)
        .sort({ createdAt: order })
        .limit(limit)
        .toArray();

    // повертаємо у старому форматі для сумісності з UI
    return rows.map(({ time, action, price, instId, createdAt }) => ({
        time, action, price, instId, createdAt,
    }));
}

/** (Опційно) кількість документів — зручно для пагінації. */
export async function countTradeHistory() {
    const db = await getDb();
    return db.collection(COL).countDocuments();
}
