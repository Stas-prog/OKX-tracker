'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'

type Wallet = {
    usdt: number
    btc: number
}

type Status = {
    action: string
    wallet: Wallet
    price: number
}

export default function VirtualTraderStatus() {
    const [status, setStatus] = useState<Status | null>(null)
    const [loading, setLoading] = useState(true)

    const fetchStatus = async () => {
        try {
            const res = await axios.get('/api/trade')
            setStatus(res.data)
            setLoading(false)
        } catch (error) {
            console.error('Помилка при завантаженні статусу трейдера', error)
        }
    }

    useEffect(() => {
        fetchStatus()
        const interval = setInterval(fetchStatus, 10000)
        return () => clearInterval(interval)
    }, [])

    if (!status) {
        return (
            <div className="mt-8 p-4 bg-gray-900 rounded shadow">
                <p className="text-gray-400">⏳ Завантаження трейдера…</p>
            </div>
        )
    }

    return (
        <div className="mt-8 p-4 bg-gray-900 rounded shadow">
            <h2 className="text-xl font-bold mb-2">🤖 Статус віртуального трейдера</h2>
            <p>Остання дія: <strong>{status.action || '—'}</strong></p>
            <p>Ціна BTC/USDT: <strong>{status.price?.toFixed(2)} $</strong></p>
            <p>USDT: <strong className="text-cyan-400">{status.wallet?.usdt?.toFixed?.(2) ?? '—'}</strong></p>
            <p>BTC: <strong className="text-orange-400">{status.wallet?.btc?.toFixed?.(6) ?? '—'}</strong></p>

        </div>
    )
}
