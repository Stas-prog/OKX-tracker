"use client";
import { useEffect, useMemo, useState } from "react";

type Settings = {
  emaFast: number;
  emaSlow: number;
  takeProfit: number;
  stopLoss: number;
  feeRate: number;
  slippage: number;
  maxBars: number;
};

const DEF: Settings = {
  emaFast: 8,
  emaSlow: 21,
  takeProfit: 0.006,
  stopLoss: 0.004,
  feeRate: 0.001,
  slippage: 0.0005,
  maxBars: 600,
};

export default function SettingsPanel({ value, onChange }: { value: Settings; onChange: (s: Settings)=>void; }) {
  const [local, setLocal] = useState<Settings>({ ...DEF, ...value });
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string|null>(null);

  useEffect(() => { setLocal({ ...DEF, ...value }); }, [value]);

  const dirty = useMemo(() => JSON.stringify(local) !== JSON.stringify({ ...DEF, ...value }), [local, value]);

  async function save() {
    try {
      setSaving(true);
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(local),
      });
      if (!res.ok) throw new Error("save failed");
      onChange(local);
      setSavedAt(new Date().toLocaleTimeString());
    } catch (e) {
      console.error("settings save", e);
    } finally {
      setSaving(false);
    }
  }

  const num = (x:any, d:number)=> {
    const v = Number(x);
    return Number.isFinite(v) ? v : d;
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white/80 p-3 text-sm shadow-soft">
      <div className="flex items-center gap-2 mb-2">
        <div className="font-semibold">⚙️ Налаштування бота (live)</div>
        <button onClick={save} disabled={!dirty || saving}
          className="ml-auto rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50">
          {saving ? "Зберігаю…" : "Зберегти"}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <L label="EMA fast">
          <I type="number" value={String(local.emaFast)}
             onChange={e => setLocal({ ...local, emaFast: num(e.target.value, DEF.emaFast) })}/>
        </L>
        <L label="EMA slow">
          <I type="number" value={String(local.emaSlow)}
             onChange={e => setLocal({ ...local, emaSlow: num(e.target.value, DEF.emaSlow) })}/>
        </L>

        <L label="Take profit (0.006 = 0.6%)">
          <I type="number" step="0.001" value={String(local.takeProfit)}
             onChange={e => setLocal({ ...local, takeProfit: num(e.target.value, DEF.takeProfit) })}/>
        </L>
        <L label="Stop loss (0.004 = 0.4%)">
          <I type="number" step="0.001" value={String(local.stopLoss)}
             onChange={e => setLocal({ ...local, stopLoss: num(e.target.value, DEF.stopLoss) })}/>
        </L>

        <L label="Fee rate (0.001 = 0.1%)">
          <I type="number" step="0.0001" value={String(local.feeRate)}
             onChange={e => setLocal({ ...local, feeRate: num(e.target.value, DEF.feeRate) })}/>
        </L>
        <L label="Slippage (0.0005 = 0.05%)">
          <I type="number" step="0.0001" value={String(local.slippage)}
             onChange={e => setLocal({ ...local, slippage: num(e.target.value, DEF.slippage) })}/>
        </L>

        <L label="Max bars">
          <I type="number" step="10" value={String(local.maxBars)}
             onChange={e => setLocal({ ...local, maxBars: num(e.target.value, DEF.maxBars) })}/>
        </L>
      </div>

      <div className="mt-2 text-xs text-slate-500">
        {savedAt ? <>Збережено о {savedAt}</> : <>Зміни поки не збережено</>}
      </div>
    </div>
  );
}

function L({ label, children }: { label:string; children:React.ReactNode }) {
  return <label className="flex flex-col gap-1"><span className="text-slate-600">{label}</span>{children}</label>;
}
function I(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="rounded border border-slate-300 bg-white px-2 py-1 outline-none focus:ring-2 focus:ring-slate-300" />;
}
