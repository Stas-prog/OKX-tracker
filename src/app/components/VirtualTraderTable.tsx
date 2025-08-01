'use client';
import { useEffect, useState } from 'react';

export default function VirtualTraderTable() {
    const [data, setData] = useState<any[]>([]);

    useEffect(() => {
        const interval = setInterval(async () => {
            const res = await fetch('/api/virtual-trader');
            const d = await res.json();
            setData(d);
        }, 5000);

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="bg-black text-white p-4 rounded-md w-full max-w-2xl mx-auto mt-6">
            <h2 className="text-lg font-bold mb-2">📊 Віртуальний трейдер</h2>
            <table className="w-full text-sm border border-gray-700">
                <thead>
                    <tr className="border-b border-gray-600">
                        <th className="py-1">Монета</th>
                        <th>Ціна</th>
                        <th>Вхід</th>
                        <th>Статус</th>
                        <th>PNL</th>
                    </tr>
                </thead>
                <tbody>
                    {data.map((d) => (
                        <tr key={d.instId} className="text-center border-b border-gray-800">
                            <td>{d.instId}</td>
                            <td>{d.currentPrice}</td>
                            <td>{d.entryPrice ?? '—'}</td>
                            <td>{d.position === 'long' ? '🟢 Куплено' : '⚪ Очікуємо'}</td>
                            <td>{d.pnl.toFixed(2)} $</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
