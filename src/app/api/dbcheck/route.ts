export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { getDb } from "@/lib/mongo";

export async function GET() {
    try {
        const db = await getDb();

        const cols = await db.listCollections().toArray();
        return NextResponse.json({
            ok: true,
            db: process.env.MONGODB_DB || "unknown",
            collections: cols.map((c) => c.name),
        });
    } catch (e: any) {
        return NextResponse.json(
            {
                ok: false,
                error: e?.message || String(e),
                uriDefined: Boolean(process.env.MONGODB_URI),
                dbDefined: Boolean(process.env.MONGODB_DB),
            },
            { status: 500 }
        );
    }
}
