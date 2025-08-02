export async function getBtcUsdtPrice(): Promise<number> {
    const res = await fetch('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT');
    const data = await res.json();
    return parseFloat(data.data[0].last);
}
