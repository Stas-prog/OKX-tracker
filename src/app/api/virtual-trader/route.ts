
import { NextResponse } from 'next/server';
import { checkAllStrategies } from '@/utils/virtualTrader';

export async function GET() {

    const result = await checkAllStrategies();

    return NextResponse.json(result);
}
