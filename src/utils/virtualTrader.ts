// Постійний (Mongo) віртуальний трейдер: стан по кожному інструменту + історія угод.
import { getDb } from "@/lib/mongo";
import { strategies } from "./strategies";
import { sendTelegramMessage } from "./sendTelegramMessage";

// ---- Типи з рядковими _id (без ObjectId) ----
type VTStateDoc = {
    _id: string;                 // instId, напр. "BTC-USDT"
    position: "none" | "long";
    entryPrice: number | null;
    pnl: number;                 // накопичений PnL у $ (спрощено)
    updatedAt: string;
};

type VTTradeDoc = {
    _id: string;                 // детермінований: <instId>|<type>|<ts>
    instId: string;
    time: string;                // ISO
    type: "buy" | "sell";
    price: number;
    pnl?: number;                // PnL на угоді (для sell)
    createdAt: string;           // ISO (для індекса/сорту)
};

// Легка обгортка для ціни OKX
async function fetchOkxLast(instId: string): Promise<number> {
    const r = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`, { cache: "no-store" });
    const j = await r.json();
    return parseFloat(j?.data?.[0]?.last ?? "0");
}

// Індекси (виконаються один раз на процес; безпечно повторювано)
let indexesEnsured = false;
async function ensureIndexes() {
    if (indexesEnsured) return;
    const db = await getDb();
    await Promise.all([
        db.collection<VTStateDoc>("vt_state").createIndex({ _id: 1 }, { name: "_id_asc", unique: true }),
        db.collection<VTTradeDoc>("vt_trades").createIndex({ createdAt: -1 }, { name: "createdAt_desc" }),
        db.collection<VTTradeDoc>("vt_trades").createIndex({ instId: 1, createdAt: -1 }, { name: "instId_createdAt" }),
    ]).catch(() => { });
    indexesEnsured = true;
}

// Завантаження/оновлення стану в Mongo
async function loadState(instId: string): Promise<VTStateDoc> {
    await ensureIndexes();
    const db = await getDb();
    const col = db.collection<VTStateDoc>("vt_state");
    const doc =
        (await col.findOne({ _id: instId })) ??
        ({
            _id: instId,
            position: "none",
            entryPrice: null,
            pnl: 0,
            updatedAt: new Date().toISOString(),
        } as VTStateDoc);
    return doc;
}

async function saveState(state: VTStateDoc) {
    const db = await getDb();
    await db.collection<VTStateDoc>("vt_state").updateOne(
        { _id: state._id },
        { $set: { ...state, updatedAt: new Date().toISOString() } },
        { upsert: true }
    );
}

async function appendTrade(t: Omit<VTTradeDoc, "_id" | "createdAt">) {
    const db = await getDb();
    const id = `${t.instId}|${t.type}|${Date.parse(t.time)}`;
    const doc: VTTradeDoc = {
        _id: id,
        ...t,
        createdAt: new Date().toISOString(),
    };
    await db.collection<VTTradeDoc>("vt_trades").updateOne({ _id: id }, { $set: doc }, { upsert: true });
}

// Публічне API: історія (останні N), опціонально по інструменту
export async function getTradeHistory(limit = 100, instId?: string): Promise<VTTradeDoc[]> {
    await ensureIndexes();
    const db = await getDb();
    const col = db.collection<VTTradeDoc>("vt_trades");
    const filter = instId ? { instId } : {};
    return col.find(filter).sort({ createdAt: -1 }).limit(Math.min(limit, 2000)).toArray();
}

// Публічне API: зводний стан по всіх стратегіях (для таблиці)
export async function getAllStates(): Promise<VTStateDoc[]> {
    await ensureIndexes();
    const db = await getDb();
    return db.collection<VTStateDoc>("vt_state").find({}).toArray();
}

// ГОЛОВНА ФУНКЦІЯ: пройти всі стратегії, оновити стан/угоди (в Mongo), повернути зведення
export async function checkAllStrategies() {
    await ensureIndexes();

    const results: Array<{
        instId: string;
        currentPrice: number;
        position: "none" | "long";
        entryPrice: number | null;
        pnl: number;
        buyBelow: number;
        sellAbove: number;
    }> = [];

    for (const strat of strategies) {
        const instId = strat.instId;
        const s = await loadState(instId);
        const currentPrice = await fetchOkxLast(instId);

        // BUY-сигнал
        if (s.position === "none" && currentPrice > 0 && currentPrice < strat.buyBelow) {
            s.position = "long";
            s.entryPrice = currentPrice;
            await appendTrade({
                instId,
                time: new Date().toISOString(),
                type: "buy",
                price: currentPrice,
            });
            await saveState(s);
            // Нехай Telegram живе, але не блокує запит
            sendTelegramMessage(`🚀 Купівля ${instId} по ${currentPrice.toFixed(2)}`);
        }

        // SELL-сигнал
        else if (s.position === "long" && s.entryPrice != null && currentPrice > strat.sellAbove) {
            const entry = s.entryPrice;
            const pnl = currentPrice - entry;
            s.pnl += pnl;
            s.position = "none";
            s.entryPrice = null;

            await appendTrade({
                instId,
                time: new Date().toISOString(),
                type: "sell",
                price: currentPrice,
                pnl,
            });
            await saveState(s);
            sendTelegramMessage(`💰 Продаж ${instId} по ${currentPrice.toFixed(2)} | PnL: ${pnl.toFixed(2)}$`);
        }

        results.push({
            instId,
            currentPrice,
            position: s.position,
            entryPrice: s.entryPrice,
            pnl: s.pnl,
            buyBelow: strat.buyBelow,
            sellAbove: strat.sellAbove,
        });
    }

    return results;
}
