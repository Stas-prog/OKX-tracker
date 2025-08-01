
import { NextResponse } from 'next/server';
import { checkStrategy } from '@/utils/virtualTrader';

export async function GET() {
    const res = await fetch('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT');
    const data = await res.json();

    const price = parseFloat(data.data?.[0]?.last || '0');
    const result = checkStrategy(price);

    return NextResponse.json(result);
}
