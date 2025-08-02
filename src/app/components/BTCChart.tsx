'use client';

import { Line } from 'react-chartjs-2';
import { useEffect, useState } from 'react';
import {
  Chart as ChartJS,
  LineElement,
  CategoryScale,
  LinearScale,
  PointElement
} from 'chart.js';

ChartJS.register(LineElement, CategoryScale, LinearScale, PointElement);

export default function BTCChart() {
  const [dataPoints, setDataPoints] = useState<{ time: string; price: number }[]>([]);

  useEffect(() => {
    const fetchPrice = async () => {
      const res = await fetch('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT');
      const json = await res.json();
      const price = parseFloat(json.data[0].last);
      const time = new Date().toLocaleTimeString();

      setDataPoints(prev => [...prev.slice(-20), { time, price }]);
    };

    fetchPrice();
    const interval = setInterval(fetchPrice, 5000);
    return () => clearInterval(interval);
  }, []);

  const chartData = {
    labels: dataPoints.map(p => p.time),
    datasets: [
      {
        label: 'BTC/USDT',
        data: dataPoints.map(p => p.price),
        borderColor: 'lime',
        backgroundColor: 'rgba(0,255,0,0.1)',
        tension: 0.3
      }
    ]
  };

  return (
    <div className="mt-10 bg-gray-900 p-6 rounded shadow">
      <h2 className="text-xl font-bold mb-4">📈 Графік BTC/USDT</h2>
      <Line data={chartData} />
    </div>
  );
}
