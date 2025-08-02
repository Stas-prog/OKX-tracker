import { NextResponse } from 'next/server';
import { getTradeHistory } from '@/lib/trade-log';

export async function GET() {
    return NextResponse.json(getTradeHistory());
}
