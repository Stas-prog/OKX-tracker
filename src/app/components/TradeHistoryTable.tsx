'use client';

import { useEffect, useState } from 'react';

type Trade = {
    time: string;
    action: string;
    price: string;
};

export default function TradeHistoryTable() {
    const [history, setHistory] = useState<Trade[]>([]);

    useEffect(() => {
        const fetchHistory = async () => {
            const res = await fetch('/api/trade-history');
            const json = await res.json();
            setHistory(json);
        };

        fetchHistory();
        const interval = setInterval(fetchHistory, 5000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="mt-10 bg-gray-900 p-6 rounded shadow">
            <h2 className="text-xl font-bold mb-4">📘 Історія трейдів</h2>
            <ul className="space-y-1">
                {history.map((t, i) => (
                    <li key={i} className="text-sm">
                        [{t.time}] {t.action} @ {t.price}
                    </li>
                ))}
            </ul>
        </div>
    );
}
