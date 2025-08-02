import { strategies } from './strategies';
import { sendTelegramMessage } from './sendTelegramMessage';


type Trade = {
    time: string;
    type: 'buy' | 'sell';
    price: number;
    instId: string;
};

type PositionState = {
    position: 'none' | 'long';
    entryPrice: number | null;
    pnl: number;
};

const tradeHistory: Trade[] = [];

export function getTradeHistory() {
    return tradeHistory;
}




const state: Record<string, PositionState> = {};

export async function checkAllStrategies() {
    const results = [];

    for (const strat of strategies) {
        if (!state[strat.instId]) {
            state[strat.instId] = { position: 'none', entryPrice: null, pnl: 0 };
        }

        const res = await fetch(`https://www.okx.com/api/v5/market/ticker?instId=${strat.instId}`);
        const json = await res.json();
        const currentPrice = parseFloat(json.data?.[0]?.last || '0');

        const s = state[strat.instId];

        if (s.position === 'none' && currentPrice < strat.buyBelow) {
            s.position = 'long';
            s.entryPrice = currentPrice;
            tradeHistory.push({
                time: new Date().toISOString(),
                type: 'buy',
                price: currentPrice,
                instId: strat.instId,
            });
            sendTelegramMessage(`🚀 Купівля ${strat.instId} за ${currentPrice.toFixed(2)}!`);

        }
        else if (s.position === 'long' && currentPrice > strat.sellAbove) {
            s.pnl += currentPrice - (s.entryPrice || 0);
            tradeHistory.push({
                time: new Date().toISOString(),
                type: 'sell',
                price: currentPrice,
                instId: strat.instId,
            });
            s.position = 'none';
            s.entryPrice = null;
            sendTelegramMessage(`💰 Продаж ${strat.instId} за ${currentPrice.toFixed(2)}! Прибуток: ${(currentPrice - (s.entryPrice || 0)).toFixed(2)}`);

        }


        results.push({
            ...strat,
            ...s,
            currentPrice,
        });
    }

    return results;
}
