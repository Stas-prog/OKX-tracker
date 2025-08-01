import { strategies } from './strategies';

type PositionState = {
    position: 'none' | 'long';
    entryPrice: number | null;
    pnl: number;
};

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
        } else if (s.position === 'long' && currentPrice > strat.sellAbove) {
            s.pnl += currentPrice - (s.entryPrice || 0);
            s.position = 'none';
            s.entryPrice = null;
        }

        results.push({
            ...strat,
            ...s,
            currentPrice,
        });
    }

    return results;
}
