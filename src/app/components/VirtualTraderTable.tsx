'use client';
import { useEffect, useState } from 'react';
import axios from 'axios';

type Row = {
  instId: string;
  price: number;
  action: any;
  wallet: any;
  lastPrice: number | null;
  position: 'none' | 'long';
  side?: 'buy' | 'sell' | 'hold';
  pnl: number; // realized PNL (Δціни)
};

const fmtNum = (v: any, digits = 2) => {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
};

export default function VirtualTraderTable() {
  // const [data, setData] = useState<Row[]>([]);
    const [data, setData] = useState<Row | null>(null)
    const [loading, setLoading] = useState(true)

    const fetchData = async () => {
        try {
            const res = await axios.get('/api/trade')
            setData(res.data)
console.log(res.data)
            setLoading(false)
        } catch (error) {
            console.error('Помилка при завантаженні статусу трейдера', error)
        }
    }

    useEffect(() => {
        fetchData()
        const interval = setInterval(fetchData, 3000)
        return () => clearInterval(interval)
    }, [])

  
 if (!data) {
    return (
      <div className="bg-black text-white p-4 rounded-md w-full max-w-3xl mx-auto mt-6">
        Loading…
      </div>
    );
  }
  const pnlClass = data.wallet?.pnl >= 0 ? 'text-green-400' : 'text-red-400';
  const pnl = data.wallet?.pnl.toFixed(2) || '-';
  const status = data.wallet?.side === 'buy'
                ? '🟢 Купую'
                : data.wallet?.side === 'sell'
                ? '🔴 Продаю'
                : data.wallet?.position === 'long'
                ? '🟢 Куплено'
                : '⚪ Очікуємо';

console.log(data) 
console.log("pnl", pnl)
  return (
    <div className="bg-black text-white p-4 rounded-md w-full max-w-3xl mx-auto mt-6">
      <h2 className="text-lg font-bold mb-2">📊 Віртуальний трейдер</h2>
      <table className="w-full text-sm border border-gray-700">
        <thead>
          <tr className="border-b border-gray-600 text-center">
            <th className="py-1">Монета</th>
            <th>Ціна</th>
            <th>Вхід</th>
            <th>Статус</th>
            <th>PNL</th>
          </tr>
        </thead>
        <tbody>           
              <tr className="text-center border-b border-gray-800">
                <td>{data.instId}</td>
                <td>{fmtNum(data.price, 2)}</td>
                <td>{data.wallet?.lastPrice != null ? fmtNum(data.wallet?.lastPrice, 2) : '—'}</td>
                <td>{status}</td>
                <td className={pnlClass}>{pnl} Δ</td>
              </tr>
        </tbody>
      </table>
    </div>
  );
}






// useEffect(() => {
  //   const fetchData = async () => {
  //     try {
  //       const res = await fetch('/api/trade');
  //       const [d] = await res.json();
  //       // const safe: Row[] = Array.isArray(d)
  //       //   ? d.map((r: any) => ({
  //       //       instId: String(r?.instId ?? 'UNKNOWN'),
  //       //       price: Number(r?.price) || 0,
  //       //       lastPrice: r?.lastPrice != null ? Number(r.lastPrice) : null,
  //       //       position: (r?.position === 'long' ? 'long' : 'none') as 'none' | 'long',
  //       //       side:
  //       //         r?.side === 'buy'
  //       //           ? 'buy'
  //       //           : r?.side === 'sell'
  //       //           ? 'sell'
  //       //           : ('hold' as const),
  //       //       pnl: Number(r?.pnl) || 0,
  //       //     }))
  //       //   : [];
  //       console.log(res) 
  //       setData(d);
  //     } catch (e) {
  //       console.error('virtual-trader fetch error', e);
  //       setData([]);
  //     } finally {
  //       setLoading(false);
  //     }
  //   };
  //   fetchData();
  //   const id = setInterval(fetchData, 5000);
  //   return () => clearInterval(id);
  // }, []);