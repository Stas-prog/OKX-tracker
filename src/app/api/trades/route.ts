import { getTradeHistory } from '@/utils/virtualTrader';
import { NextResponse } from 'next/server';

export function GET() {
    return NextResponse.json(getTradeHistory());
}
