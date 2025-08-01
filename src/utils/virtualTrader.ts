let position: 'none' | 'long' = 'none';
let entryPrice: number | null = null;
let pnl: number = 0;

export function checkStrategy(currentPrice: number) {
    const buyThreshold = 57000;
    const sellThreshold = 59000;

    if (position === 'none' && currentPrice < buyThreshold) {
        position = 'long';
        entryPrice = currentPrice;
        console.log(`💰 Віртуальна покупка за ціною ${currentPrice}`);
    } else if (position === 'long' && currentPrice > sellThreshold) {
        pnl += currentPrice - (entryPrice || 0);
        console.log(`✅ Продаж за ${currentPrice}, профіт ${pnl}`);
        position = 'none';
        entryPrice = null;
    }

    return {
        position,
        entryPrice,
        pnl,
        currentPrice,
    };
}
