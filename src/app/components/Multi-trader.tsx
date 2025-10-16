"use client";
import { useState } from "react";

export default function RunTickButton({ token }: { token: any }) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);

  async function run() {
    setLoading(true);
    try {
      const res = await fetch("/api/cron/run-tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      const j = await res.json();
      setResult(j);
    } catch (e) {
      setResult({ ok: false, error: String(e) });
    } finally { setLoading(false); }
  }

  return (
    <div className="flex gap-3">
      <button className="px-4 py-2 rounded bg-amber-400 text-black" onClick={run} disabled={loading}>
        {loading ? "Запускаю…" : "Запустити tick"}
      </button>
      {result && <pre className="text-xs bg-black/40 p-2 rounded">{JSON.stringify(result, null, 2)}</pre>}
    </div>
  );
}
