import { NextResponse } from 'next/server';

export async function GET() {
    const res = await fetch('https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT');

    if (!res.ok) {
        return NextResponse.json({ error: 'Failed to fetch ticker' }, { status: 500 });
    }

    const data = await res.json();
    return NextResponse.json(data);
}
