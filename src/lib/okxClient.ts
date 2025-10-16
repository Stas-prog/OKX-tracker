export async function getBtcUsdtPrice(): Promise<number> {
    const res = await fetch('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT');
    const data = await res.json();
    return parseFloat(data.data[0].last);
}

export async function getPrice(instId: string): Promise<number> {
  const url = `https://www.okx.com/api/v5/market/ticker?instId=${instId}&ts=${Date.now()}`;
  const res = await fetch(url, {
    // важливо для Next/Node 18+
    cache: "no-store",
    // перестраховка від CDN
    headers: { "cache-control": "no-cache" },
  });
  const data = await res.json();
  if (!data?.data?.[0]?.last) throw new Error(`No ticker data for ${instId}`);
  return parseFloat(data.data[0].last);
}

