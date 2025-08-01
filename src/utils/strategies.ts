export type Strategy = {
    instId: string;
    buyBelow: number;
    sellAbove: number;
};

export const strategies: Strategy[] = [
    {
        instId: 'BTC-USDT',
        buyBelow: 57000,
        sellAbove: 59000,
    },
    {
        instId: 'ETH-USDT',
        buyBelow: 2900,
        sellAbove: 3100,
    },
    {
        instId: 'SOL-USDT',
        buyBelow: 130,
        sellAbove: 150,
    },
];
