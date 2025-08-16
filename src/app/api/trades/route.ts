export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

/** Документ угоди у Mongo */
type TradeDoc = {
    _id: string;                 // side|ts|price|qtyKey
    side: "BUY" | "SELL";
    price: number;
    qty: number;
    ts: number;                  // timestamp свічки/угоди
    pnlUSDT?: number;
    instId?: string;             // "BTC-USDT"
    tf?: "1m" | "5m" | "15m";
    createdAt: string;           // ISO
};

// ====== GET: фільтри + пагінація + сортування + CSV ======
// /api/trades?limit=50&page=1&order=desc&sort=createdAt
//   &side=BUY&instId=BTC-USDT&tf=1m&since=ISO&before=ISO&q=btc buy&format=csv
export async function GET(req: Request) {
    const url = new URL(req.url);

    const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 500);
    const page = Math.max(parseInt(url.searchParams.get("page") || "1", 10) || 1, 1);

    const orderStr = (url.searchParams.get("order") || "desc").toLowerCase();
    const order = orderStr === "asc" ? 1 : -1;

    // sort field: createdAt | ts | price
    const sortField = (url.searchParams.get("sort") || "createdAt") as "createdAt" | "ts" | "price";
    const sort: Record<string, 1 | -1> = { [sortField]: order };

    const side = url.searchParams.get("side") as "BUY" | "SELL" | null;
    const instId = url.searchParams.get("instId");
    const tf = url.searchParams.get("tf") as "1m" | "5m" | "15m" | null;

    const since = url.searchParams.get("since");   // createdAt > since
    const before = url.searchParams.get("before"); // createdAt < before

    // q — пошук по кількох словах: шукаємо серед instId/side/price (як текст)
    const q = (url.searchParams.get("q") || "").trim();

    const format = (url.searchParams.get("format") || "json").toLowerCase(); // json | csv

    const db = await getDb();
    const col = db.collection<TradeDoc>("trades");

    const filter: any = {};
    if (side) filter.side = side;
    if (instId) filter.instId = instId;
    if (tf) filter.tf = tf;
    if (since || before) {
        filter.createdAt = {};
        if (since) filter.createdAt.$gt = since;
        if (before) filter.createdAt.$lt = before;
    }
    if (q) {
        const terms = q
            .split(/\s+/)
            .map(t => t.trim())
            .filter(Boolean);
        if (terms.length) {
            // будуємо $and із $or по кільком полям як рядок
            filter.$and = terms.map((t) => ({
                $or: [
                    { instId: { $regex: t, $options: "i" } },
                    { side: { $regex: t, $options: "i" } },
                    { tf: { $regex: t, $options: "i" } },
                    // price/qty/pnl як текст — неідеально, але працює для швидкого пошуку
                    { createdAt: { $regex: t, $options: "i" } },
                ],
            }));
        }
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
        col.find(filter).sort(sort).skip(skip).limit(limit).toArray(),
        col.countDocuments(filter),
    ]);

    if (format === "csv") {
        const csv = toCSV(items);
        return new NextResponse(csv, {
            headers: {
                "content-type": "text/csv; charset=utf-8",
                "content-disposition": `attachment; filename="trades_page${page}.csv"`,
            },
        });
    }

    return NextResponse.json({
        items,
        page,
        limit,
        total,
        pages: Math.max(1, Math.ceil(total / limit)),
        sort: sortField,
        order: orderStr,
    });
}

function toCSV(rows: TradeDoc[]): string {
    const header = [
        "_id", "createdAt", "ts", "instId", "tf", "side", "price", "qty", "pnlUSDT"
    ].join(",");

    const body = rows.map(r => [
        safe(r._id),
        safe(r.createdAt),
        String(r.ts ?? ""),
        safe(r.instId ?? ""),
        safe(r.tf ?? ""),
        safe(r.side ?? ""),
        String(r.price ?? ""),
        String(r.qty ?? ""),
        r.pnlUSDT == null ? "" : String(r.pnlUSDT),
    ].join(",")).join("\n");

    return header + "\n" + body + "\n";
}
function safe(s: string) {
    // обгортаємо комою, якщо містить кому/лапки/перенос
    if (/[",\n]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
}

// ====== POST: детермінований upsert, щоб не було дублів ======
export async function POST(req: Request) {
    const body = await req.json() as Partial<TradeDoc> & { side: "BUY" | "SELL"; price: number; qty: number; ts: number; };

    const db = await getDb();
    const col = db.collection<TradeDoc>("trades");

    const qtyKey = Number(body.qty).toFixed(6);
    const id = `${body.side}|${Number(body.ts)}|${Number(body.price)}|${qtyKey}`;

    const doc: TradeDoc = {
        _id: id,
        side: body.side!,
        price: Number(body.price),
        qty: Number(body.qty),
        ts: Number(body.ts),
        pnlUSDT: body.pnlUSDT !== undefined ? Number(body.pnlUSDT) : undefined,
        instId: body.instId,
        tf: body.tf as any,
        createdAt: body.createdAt || new Date().toISOString(),
    };

    await col.updateOne({ _id: id }, { $set: doc }, { upsert: true });
    return NextResponse.json({ ok: true, _id: id });
}
