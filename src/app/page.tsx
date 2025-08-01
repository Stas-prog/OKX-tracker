'use client'

import { useEffect, useState } from 'react'
import axios from 'axios'
import VirtualTraderStatus from './components/VirtualTraderStatus';


type Ticker = {
  instId: string
  last: string
  high24h: string
  low24h: string
}

export default function HomePage() {
  const [tickers, setTickers] = useState<Ticker[]>([])

  const fetchPrices = async () => {
    try {
      const pairs = ['BTC-USDT', 'ETH-USDT', 'XRP-USDT']
      const results = await Promise.all(
        pairs.map(pair =>
          axios.get(`https://www.okx.com/api/v5/market/ticker?instId=${pair}`)
        )
      )

      const prices: Ticker[] = results.map(res => res.data.data[0])
      setTickers(prices)
    } catch (err) {
      console.error('Помилка при отриманні даних', err)
    }
  }

  useEffect(() => {
    fetchPrices()
    const interval = setInterval(fetchPrices, 10000)
    return () => clearInterval(interval)
  }, [])

  return (
    <main className="min-h-screen p-10 bg-black text-white">
      <h1 className="text-3xl font-bold mb-6">💹 Курси валют (OKX)</h1>
      <ul className="space-y-4">
        {tickers.map(t => (
          <li key={t.instId} className="bg-gray-800 p-4 rounded shadow">
            <h2 className="text-xl font-semibold">{t.instId}</h2>
            <p>Остання ціна: <strong>{t.last}</strong></p>
            <p>Макс за 24h: {t.high24h}</p>
            <p>Мін за 24h: {t.low24h}</p>
          </li>
        ))}
      </ul>
      <VirtualTraderStatus />
    </main>
  )
}
