
import crypto from "crypto";

// =========================
// OKX BASE FETCH + SIGN
// =========================
const OKX_BASE = "https://www.okx.com";



function okxSign(ts: string, method: string, path: string, body: string, secret: string) {
  const prehash = ts + method.toUpperCase() + path + body;
  return crypto.createHmac("sha256", secret).update(prehash).digest("base64");
}

async function okxFetch<T = any>(path: string, method: "GET" | "POST", body?: any): Promise<T> {
  const key = process.env.OKX_API_KEY!;
  const secret = process.env.OKX_API_SECRET!;
  const passphrase = process.env.OKX_API_PASSPHRASE!;
  if (!key || !secret || !passphrase) {
    throw new Error("OKX creds missing: OKX_API_KEY/OKX_API_SECRET/OKX_API_PASSPHRASE");
  }

  const fullPath = `/api/v5${path}`;
  const bodyStr = method === "POST" ? JSON.stringify(body ?? {}) : "";
  const ts = new Date().toISOString();
  const sign = okxSign(ts, method, fullPath, bodyStr, secret);

  const res = await fetch(OKX_BASE + fullPath, {
    method,
    headers: {
      "Content-Type": "application/json",
      "OK-ACCESS-KEY": key,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": ts,
      "OK-ACCESS-PASSPHRASE": passphrase,
      "x-simulated-trading": "0", // 0=real; 1=paper (вимкни/увімкни за потреби)
    },
    body: bodyStr || undefined,
    cache: "no-store",
  });

  const json: any = await res.json().catch(() => ({}));
  if (json?.code && json.code !== "0") {
    const d0 = json?.data?.[0] || {};
    const sc = d0?.sCode ? ` sCode=${d0.sCode}` : "";
    const sm = d0?.sMsg ? ` sMsg=${d0.sMsg}` : "";
    throw new Error(`OKX API ${json.code}: ${json.msg || "error"}${sc}${sm}`);
  }
  return json as T;
}

// =========================
// PUBLIC / ACCOUNT HELPERS
// =========================

export async function getInstrumentInfo(instId: string) {
  const j = await okxFetch<any>(`/public/instruments?instType=SPOT&instId=${instId}`, "GET");
  const info = j?.data?.[0];
  if (!info) throw new Error("No instrument info");
  return {
    instId: info.instId as string,
    lotSz: info.lotSz as string,   // крок базової кількості (BTC)
    minSz: info.minSz as string,   // мінімальна базова кількість
    tickSz: info.tickSz as string, // крок ціни
  };
}

export async function getSpotTicker(instId: string) {
  const j = await okxFetch<any>(`/market/ticker?instId=${instId}`, "GET");
  const d = j?.data?.[0];
  return {
    last: Number(d?.last || 0),
    ask: Number(d?.askPx || 0),
    bid: Number(d?.bidPx || 0),
  };
}

export async function getBestAsk(instId: string): Promise<number> {
  const j = await okxFetch<any>(`/market/books?instId=${instId}&sz=1`, "GET");
  const ask = Number(j?.data?.[0]?.asks?.[0]?.[0] ?? NaN);
  if (!Number.isFinite(ask) || ask <= 0) throw new Error("No best ask");
  return ask;
}

/** Trading balance (не Funding). Повертає { USDT, BTC, ... } */
export async function getBalances(): Promise<Record<string, number>> {
  const j = await okxFetch<any>("/account/balance?ccy=USDT,BTC", "GET");
  const details = j?.data?.[0]?.details ?? [];
  const out: Record<string, number> = {};
  for (const d of details) {
    // availBal — доступний, cashBal — загальний
    out[d.ccy] = Number(d.availBal ?? d.cashBal ?? 0);
  }
  return out;
}

// >>> SHIM для зворотної сумісності зі старим кодом
export async function getWalletBalance() {
  const b = await getBalances();
  return { usdt: b.USDT || 0, btc: b.BTC || 0 };
}


// =========================
// UTILS
// =========================
function decimals(step: string) {
  const i = step.indexOf(".");
  return i === -1 ? 0 : step.length - i - 1;
}
function quantizeToStep(v: number, step: string, dir: "floor" | "ceil" = "floor") {
  const s = parseFloat(step);
  if (!(s > 0)) return v;
  const n = v / s;
  const q = dir === "ceil" ? Math.ceil(n) * s : Math.floor(n) * s;
  const d = decimals(step);
  return Number(q.toFixed(d));
}

// =========================
// SPOT MARKET ALL-IN ORDER
// =========================

const MIN_NOTIONAL_USDT = 6.0; // запас над 5 USDT

export type PlaceResult =
  | { ok: true; skipped?: false; orderId: string | null; side: "buy" | "sell"; sent: any; meta: any }
  | { ok: false; skipped: true; reason: string; meta?: any }
  | { ok: false; skipped?: false; error: string; meta?: any };

/**
 * ALL-IN логіка:
 * - BUY: купуємо на весь Trading USDT (-1% запас), через tgtCcy="quote_ccy"
 * - SELL: продаємо весь Trading BTC (-0.1% запас), sz у базі, без tgtCcy
 * Якщо не проходимо мінімальні пороги — повертаємо skipped (НЕ кидаємо помилку).
 */
export async function placeSpotOrder(params: {
  instId: string;                  // "BTC-USDT"
  side: "buy" | "sell";
  amountUsd?: number;              // (опц.) якщо задано → купуємо рівно на цю суму USDT
  sizeBase?: number;               // (опц.) якщо задано → продаємо рівно стільки BTC
}): Promise<PlaceResult> {
  try {
    const { instId, side, amountUsd, sizeBase } = params;
    const [info, ask, balances] = await Promise.all([
      getInstrumentInfo(instId),
      getBestAsk(instId),
      getBalances(),
    ]);
    const usdtAvail = Number(balances.USDT || 0);
    const btcAvail  = Number(balances.BTC  || 0);

    if (side === "buy") {
      // Якщо передано amountUsd → купуємо саме на цю суму, інакше ALL-IN (весь Trading USDT)
      const targetUsd = typeof amountUsd === "number" && amountUsd > 0
        ? Math.min(amountUsd, usdtAvail)       // не більше, ніж доступно
        : usdtAvail * 0.99;                    // all-in з невеликим запасом

      const spendUsd = Math.floor(targetUsd * 100) / 100; // 2 знаки вниз
      if (spendUsd < MIN_NOTIONAL_USDT) {
        return { ok: false, skipped: true, reason: "LOW_USDT", meta: { usdtAvail, need: MIN_NOTIONAL_USDT } };
      }

      const body = {
        instId,
        tdMode: "cash",
        side: "buy",
        ordType: "market",
        tgtCcy: "quote_ccy",       // MARKET BUY на суму в USDT
        sz: spendUsd.toFixed(2),
      };

      console.log("[OKX SUBMIT BUY]", { instId, ask, usdtAvail, btcAvail, body });
      const okxRes = await okxFetch<{ data: Array<{ ordId: string }> }>("/trade/order", "POST", body);
      const d0 = okxRes?.data?.[0];
      return { ok: true, orderId: d0?.ordId ?? null, side, sent: body, meta: { ask, usdtAvail, btcAvail, info } };
    }

    // SELL:
    const baseToSell = typeof sizeBase === "number" && sizeBase > 0
      ? Math.min(sizeBase, btcAvail)
      : btcAvail * 0.999; // all-in

    if (baseToSell <= 0) {
      return { ok: false, skipped: true, reason: "LOW_BTC", meta: { btcAvail } };
    }

    let szQ = quantizeToStep(baseToSell, info.lotSz, "floor");
    const d = Math.max(decimals(info.lotSz), decimals(info.minSz));
    if (szQ < Number(info.minSz)) szQ = Number(Number(info.minSz).toFixed(d));

    const notional = szQ * ask;
    if (notional < MIN_NOTIONAL_USDT) {
      return { ok: false, skipped: true, reason: "LOW_NOTIONAL_SELL", meta: { szQ, ask, notional: Number(notional.toFixed(4)), need: MIN_NOTIONAL_USDT } };
    }

    const body = {
      instId,
      tdMode: "cash",
      side: "sell",
      ordType: "market",
      sz: szQ.toFixed(d), // кількість BTC
    };

    console.log("[OKX SUBMIT SELL]", { instId, ask, usdtAvail, btcAvail, lotSz: info.lotSz, minSz: info.minSz, szQ, notional: Number(notional.toFixed(6)), body });
    const okxRes = await okxFetch<{ data: Array<{ ordId: string }> }>("/trade/order", "POST", body);
    const d0 = okxRes?.data?.[0];
    return { ok: true, orderId: d0?.ordId ?? null, side, sent: body, meta: { ask, usdtAvail, btcAvail, info } };

  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}



