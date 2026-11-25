
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const expected = process.env.CRON_SECRET;

    // Перевіряємо, що запит прийшов із нашого сайту
    const origin = req.headers.get("origin");
    const appUrl = process.env.NEXT_PUBLIC_BASE_URL;

    if (
      origin &&
      appUrl &&
      new URL(origin).origin !== new URL(appUrl).origin
    ) {
      return NextResponse.json(
        { ok: false, message: "Invalid origin" },
        { status: 403 }
      );
    }

    if (!expected) {
      return NextResponse.json(
        { ok: false, message: "CRON_SECRET is not configured" },
        { status: 500 }
      );
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_BASE_URL || "http://localhost:3000";

    const res = await fetch(
      `${baseUrl}/api/cron/multi-tick`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${expected}`,
        },
        cache: "no-store",
      }
    );

    const json = await res.json().catch(() => ({
      ok: false,
      message: "Invalid response from multi-tick",
    }));

    return NextResponse.json(json, { status: res.status });
  } catch (error) {
    console.error("run-tick error:", error);

    return NextResponse.json(
      { ok: false, message: "Failed to run MultiTrader tick" },
      { status: 500 }
    );
  }
}