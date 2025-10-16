import React from "react";
import { getDb } from "@/lib/mongo";
import RunTickButton from "../components/Multi-trader"; 

type InstState = {
  instId: string;
  allocatedUsd: number;
  quantity: number;
  avgEntryPrice: number;
  lastBuyTimestamp?: string;
  lastSellTimestamp?: string;
};

type MultiState = {
  strategyId?: string;
  capitalUsd: number;
  cashUsd: number;
  instStates: InstState[];
  updatedAt?: string;
};

export const metadata = {
  title: "MultiTrader — Overview",
  description: "Поточний стан портфеля та історія угод MultiTrader.",
};

async function fetchData() {
  const db = await getDb();
  // Підстав свій strategyId якщо інший:
  const strategyId = "multi-5-default";
  const state = (await db.collection("multi_state").findOne({ strategyId })) as MultiState | null;

  const trades = await db
    .collection("multi_trades")
    .find({})
    .sort({ createdAt: -1 })
    .limit(100)
    .toArray();

  return { state, trades };
}

export default async function Page() {
  const { state, trades } = await fetchData();

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        <header>
          <h1 className="text-3xl font-extrabold">MultiTrader — Огляд</h1>
          <p className="text-zinc-400 mt-1">
            Поточний стан портфеля та останні ордери (симуляція чи реальні — залежно від налаштувань).
          </p>
        </header>
        <RunTickButton token={process.env.CRON_SECRET}/>
        {/* Summary */}
        <section className="grid sm:grid-cols-3 gap-4">
          <div className="rounded-2xl p-5 bg-white/5 ring-1 ring-white/10">
            <div className="text-sm text-zinc-400">Стратегія</div>
            <div className="text-xl font-semibold">{state?.strategyId ?? "—"}</div>
          </div>
          <div className="rounded-2xl p-5 bg-white/5 ring-1 ring-white/10">
            <div className="text-sm text-zinc-400">Капітал (USD)</div>
            <div className="text-xl font-semibold">
              {state ? state.capitalUsd.toFixed(2) : "—"}
            </div>
          </div>
          <div className="rounded-2xl p-5 bg-white/5 ring-1 ring-white/10">
            <div className="text-sm text-zinc-400">Вільні кошти (USD)</div>
            <div className="text-xl font-semibold">
              {state ? state.cashUsd.toFixed(2) : "—"}
            </div>
          </div>
        </section>

        {/* Positions */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Позиції</h2>
          <div className="overflow-x-auto rounded-2xl ring-1 ring-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr className="text-left">
                  <th className="px-4 py-3">Інструмент</th>
                  <th className="px-4 py-3">Alloc (USD)</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Avg Entry</th>
                  <th className="px-4 py-3">Остання купівля</th>
                  <th className="px-4 py-3">Останній продаж</th>
                </tr>
              </thead>
              <tbody>
                {state?.instStates?.length ? (
                  state.instStates.map((s) => (
                    <tr key={s.instId} className="border-t border-white/10">
                      <td className="px-4 py-3 font-medium">{s.instId}</td>
                      <td className="px-4 py-3">{s.allocatedUsd.toFixed(2)}</td>
                      <td className="px-4 py-3">{s.quantity.toFixed(8)}</td>
                      <td className="px-4 py-3">{s.avgEntryPrice ? s.avgEntryPrice.toFixed(6) : "—"}</td>
                      <td className="px-4 py-3 text-zinc-400">{s.lastBuyTimestamp ?? "—"}</td>
                      <td className="px-4 py-3 text-zinc-400">{s.lastSellTimestamp ?? "—"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-6 text-zinc-400" colSpan={6}>
                      Позицій поки немає.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-zinc-500">
            Оновлено: {state?.updatedAt ? new Date(state.updatedAt).toLocaleString() : "—"}
          </div>
        </section>

        {/* Trades */}
        <section className="space-y-4">
          <h2 className="text-2xl font-bold">Останні угоди</h2>
          <div className="overflow-x-auto rounded-2xl ring-1 ring-white/10">
            <table className="w-full text-sm">
              <thead className="bg-white/5">
                <tr className="text-left">
                  <th className="px-4 py-3">Час</th>
                  <th className="px-4 py-3">Інструмент</th>
                  <th className="px-4 py-3">Сторона</th>
                  <th className="px-4 py-3">Ціна</th>
                  <th className="px-4 py-3">Qty</th>
                  <th className="px-4 py-3">Сума (USD)</th>
                  <th className="px-4 py-3">Причина</th>
                  <th className="px-4 py-3">ID</th>
                </tr>
              </thead>
              <tbody>
                {trades.length ? (
                  trades.map((t: any) => (
                    <tr key={t._id} className="border-t border-white/10">
                      <td className="px-4 py-3 text-zinc-400">
                        {t.ts ? new Date(t.ts).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 font-medium">{t.instId}</td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-1 rounded-full text-xs ${t.side === "buy" ? "bg-emerald-500/20 text-emerald-300" : "bg-rose-500/20 text-rose-300"}`}>
                          {t.side?.toUpperCase?.() ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">{t.price?.toFixed ? t.price.toFixed(6) : t.price}</td>
                      <td className="px-4 py-3">{t.quantity?.toFixed ? t.quantity.toFixed(8) : t.quantity}</td>
                      <td className="px-4 py-3">{t.amountUsd?.toFixed ? t.amountUsd.toFixed(2) : t.amountUsd}</td>
                      <td className="px-4 py-3 text-zinc-400">{t.reason ?? "—"}</td>
                      <td className="px-4 py-3 text-zinc-500">{t.id ?? "—"}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-6 text-zinc-400" colSpan={8}>
                      Угод поки що немає. Вони з’являться після спрацювання сигналів (take-profit / stop-loss / staircase / ребаланс).
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
