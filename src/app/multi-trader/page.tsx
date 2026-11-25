
"use client";

import React, { useState, useEffect, useCallback } from "react";
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

export default function Page() {
  const [state, setState] = useState<MultiState | null>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch("/api/multi-trader/overview", {
        cache: "no-store",
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.message || "Не вдалося завантажити дані");
      }

      setState(data.state);
      setTrades(data.trades ?? []);
      setError("");
    } catch (err) {
      console.error("MultiTrader fetch error:", err);
      setError("Не вдалося завантажити дані MultiTrader");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();

    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, [fetchData]);

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100">
      <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
        <header>
          <h1 className="text-3xl font-extrabold">
            MultiTrader — Огляд
          </h1>
          <p className="text-zinc-400 mt-1">
            Поточний стан портфеля та останні ордери симуляції.
          </p>
        </header>

        <RunTickButton />

        {loading && (
          <p className="text-zinc-400">Завантаження даних...</p>
        )}

        {error && (
          <p className="text-red-400">{error}</p>
        )}

        <section className="grid sm:grid-cols-3 gap-4">
          <div className="rounded-2xl p-5 bg-white/5 ring-1 ring-white/10">
            <div className="text-sm text-zinc-400">Стратегія</div>
            <div className="text-xl font-semibold">
              {state?.strategyId ?? "—"}
            </div>
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
                      <td className="px-4 py-3">
                        {s.avgEntryPrice
                          ? s.avgEntryPrice.toFixed(6)
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {s.lastBuyTimestamp ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {s.lastSellTimestamp ?? "—"}
                      </td>
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
            Оновлено:{" "}
            {state?.updatedAt
              ? new Date(state.updatedAt).toLocaleString()
              : "—"}
          </div>
        </section>

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
                    <tr
                      key={String(t._id ?? t.id)}
                      className="border-t border-white/10"
                    >
                      <td className="px-4 py-3 text-zinc-400">
                        {t.ts ? new Date(t.ts).toLocaleString() : "—"}
                      </td>
                      <td className="px-4 py-3 font-medium">{t.instId}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs ${
                            t.side === "buy"
                              ? "bg-emerald-500/20 text-emerald-300"
                              : "bg-rose-500/20 text-rose-300"
                          }`}
                        >
                          {t.side?.toUpperCase?.() ?? "—"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {t.price?.toFixed
                          ? t.price.toFixed(6)
                          : t.price}
                      </td>
                      <td className="px-4 py-3">
                        {t.quantity?.toFixed
                          ? t.quantity.toFixed(8)
                          : t.quantity}
                      </td>
                      <td className="px-4 py-3">
                        {t.amountUsd?.toFixed
                          ? t.amountUsd.toFixed(2)
                          : t.amountUsd}
                      </td>
                      <td className="px-4 py-3 text-zinc-400">
                        {t.reason ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-zinc-500">
                        {t.id ?? "—"}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td className="px-4 py-6 text-zinc-400" colSpan={8}>
                      Угод поки що немає.
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