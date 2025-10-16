"use client";
import { useEffect, useState } from "react";

type Row = {
  _id: string;
  source: "trades" | "vt_trades" | "multi_trades";
  instId: string;
  side: "buy" | "sell";
  price: number;
  quantity: number;
  amountUsd?: number;
  reason?: string;
  ts?: string;
  createdAt?: string;
};

export default function TradeHistoryTable() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/trade-history?limit=50");
        const json = await res.json();
        if (json.ok) setRows(json.rows);
      } catch (e) {
        console.error("TradeHistory fetch error", e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return <div className="p-4">Loading...</div>;
  if (!rows.length) return <div className="p-4">No trades yet</div>;

  const badgeColor = (src: string) =>
    src === "multi_trades" ? "bg-purple-200 text-purple-800"
    : src === "vt_trades" ? "bg-blue-200 text-blue-800"
    : "bg-green-200 text-green-800";

  const sideColor = (side: string) =>
    side === "buy" ? "text-green-600 font-bold" : "text-red-600 font-bold";

  return (
    <div className="overflow-x-auto p-4">
      <table className="min-w-full border border-gray-200 text-sm">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-2 py-1 border text-green-900">Time</th>
            <th className="px-2 py-1 border text-green-900">Source</th>
            <th className="px-2 py-1 border text-green-900">Inst</th>
            <th className="px-2 py-1 border text-green-900">Side</th>
            <th className="px-2 py-1 border text-green-900">Price</th>
            <th className="px-2 py-1 border text-green-900">Qty</th>
            <th className="px-2 py-1 border text-green-900">USD</th>
            <th className="px-2 py-1 border text-green-900">Reason</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r._id}>
              <td className="px-2 py-1 border text-xs">
                {r.ts
                  ? new Date(r.ts).toLocaleString()
                  : r.createdAt
                  ? new Date(r.createdAt).toLocaleString()
                  : "-"}
              </td>
              <td className="px-2 py-1 border">
                <span className={`px-2 py-0.5 rounded text-xs ${badgeColor(r.source)}`}>
                  {r.source.replace("_trades", "")}
                </span>
              </td>
              <td className="px-2 py-1 border">{r.instId}</td>
              <td className={`px-2 py-1 border ${sideColor(r.side)}`}>{r.side}</td>
              <td className="px-2 py-1 border">{r.price?.toFixed(2)}</td>
              <td className="px-2 py-1 border">{r.quantity?.toFixed(4)}</td>
              <td className="px-2 py-1 border">{r.amountUsd?.toFixed(2)}</td>
              <td className="px-2 py-1 border text-xs">{r.reason ?? "-"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
