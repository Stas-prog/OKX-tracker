'use client';

import { useEffect, useState } from 'react';

export default function VirtualTraderStatus() {
    const [status, setStatus] = useState<any>(null);

    useEffect(() => {
        const interval = setInterval(async () => {
            const res = await fetch('/api/virtual-trader');
            const data = await res.json();
            setStatus(data);
        }, 5000); // кожні 5 секунд

        return () => clearInterval(interval);
    }, []);

    return (
        <div className="text-sm bg-black text-white p-3 rounded shadow-md">
            <p>📈 Поточна ціна: {status?.currentPrice || '—'} USD</p>
            <p>📊 Статус: {status?.position === 'long' ? 'Куплено' : 'Очікуємо'}</p>
            <p>💼 Ціна входу: {status?.entryPrice || '—'}</p>
            <p>💵 Профіт: {status?.pnl?.toFixed(2) || '0'} USD</p>
        </div>
    );
}
