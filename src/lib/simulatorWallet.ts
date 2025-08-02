let usdtBalance = 1000;
let btcBalance = 0;
let lastPrice = 0;

export function getWallet() {
    return { usdtBalance, btcBalance, lastPrice };
}

export function updateWallet(price: number) {
    if (lastPrice === 0) {
        lastPrice = price;
        return '⏳ Очікуємо старт...';
    }

    const change = (price - lastPrice) / lastPrice;

    if (change > 0.002 && usdtBalance > 10) {
        // Купуємо BTC на 10% балансу
        const amountToSpend = usdtBalance * 0.1;
        const btcToBuy = amountToSpend / price;
        usdtBalance -= amountToSpend;
        btcBalance += btcToBuy;
        lastPrice = price;
        return `🟢 Куплено ${btcToBuy.toFixed(5)} BTC по ${price}`;
    }

    if (change < -0.002 && btcBalance > 0.001) {
        // Продаємо 10% BTC
        const btcToSell = btcBalance * 0.1;
        const usdtFromSell = btcToSell * price;
        btcBalance -= btcToSell;
        usdtBalance += usdtFromSell;
        lastPrice = price;
        return `🔴 Продано ${btcToSell.toFixed(5)} BTC по ${price}`;
    }

    return `🟡 Нічого не робимо. Зміна: ${(change * 100).toFixed(2)}%`;
}
