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

export default function SettingsPanel({
    value,
    onChange,
}: {
    value: Settings;
    onChange: (s: Settings) => void;
}) {
    const [local, setLocal] = useState<Settings>(value);
    const [saving, setSaving] = useState(false);
    const [savedAt, setSavedAt] = useState<string | null>(null);
    const dirty = useMemo(() => JSON.stringify(local) !== JSON.stringify(value), [local, value]);

    useEffect(() => { setLocal(value); }, [value]);

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

    return (
        <div className="rounded-xl border border-slate-200 bg-white/80 p-3 text-sm shadow-soft">
            <div className="flex items-center gap-2 mb-2">
                <div className="font-semibold">⚙️ Налаштування бота (live)</div>
                <button
                    onClick={save}
                    disabled={!dirty || saving}
                    className="ml-auto rounded bg-slate-900 px-3 py-1 text-white disabled:opacity-50"
                >
                    {saving ? "Зберігаю…" : "Зберегти"}
                </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
                <L label="EMA fast">
                    <I type="number" min={1} max={200} step="1"
                        value={local.emaFast}
                        onChange={e => setLocal({ ...local, emaFast: Number(e.target.value) })} />
                </L>
                <L label="EMA slow">
                    <I type="number" min={1} max={400} step="1"
                        value={local.emaSlow}
                        onChange={e => setLocal({ ...local, emaSlow: Number(e.target.value) })} />
                </L>

                <L label="Take profit (0.04 = 4%)">
                    <I type="number" min={0} max={1} step="0.001"
                        value={local.takeProfit}
                        onChange={e => setLocal({ ...local, takeProfit: Number(e.target.value) })} />
                </L>
                <L label="Stop loss (0.02 = 2%)">
                    <I type="number" min={0} max={1} step="0.001"
                        value={local.stopLoss}
                        onChange={e => setLocal({ ...local, stopLoss: Number(e.target.value) })} />
                </L>

                <L label="Fee rate (0.001 = 0.1%)">
                    <I type="number" min={0} max={0.01} step="0.0001"
                        value={local.feeRate}
                        onChange={e => setLocal({ ...local, feeRate: Number(e.target.value) })} />
                </L>
                <L label="Slippage (0.0005 = 0.05%)">
                    <I type="number" min={0} max={0.01} step="0.0001"
                        value={local.slippage}
                        onChange={e => setLocal({ ...local, slippage: Number(e.target.value) })} />
                </L>

                <L label="Max bars">
                    <I type="number" min={50} max={2000} step="10"
                        value={local.maxBars}
                        onChange={e => setLocal({ ...local, maxBars: Number(e.target.value) })} />
                </L>
            </div>

            <div className="mt-2 text-xs text-slate-500">
                {savedAt ? <>Збережено о {savedAt}</> : <>Зміни поки не збережено</>}
            </div>
        </div>
    );
}

function L({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="flex flex-col gap-1">
            <span className="text-slate-600">{label}</span>
            {children}
        </label>
    );
}
function I(props: React.InputHTMLAttributes<HTMLInputElement>) {
    return (
        <input
            {...props}
            className="rounded border border-slate-300 bg-white px-2 py-1 outline-none focus:ring-2 focus:ring-slate-300"
        />
    );
}
