
import { NextResponse } from 'next/server';
import { getBtcUsdtPrice } from '@/lib/okxClient';
import { getWallet, updateWallet } from '@/lib/simulatorWallet';
import { addTrade } from '@/lib/trade-log';

export async function GET() {
    try {
        const price = await getBtcUsdtPrice();
        const action = updateWallet(price);
        const wallet = getWallet();

        // Запис у лог історії трейдів, якщо є дія BUY або SELL
        if (action === 'BUY' || action === 'SELL') {
            addTrade({
                action,
                price,
                time: new Date().toLocaleTimeString(),
            });
        }

        return NextResponse.json({
            action,
            wallet,
            price,
        });
    } catch (error) {
        console.error('❌ Помилка в API /api/trade:', error);
        return NextResponse.json({ error: 'Щось пішло не так' }, { status: 500 });
    }
}

