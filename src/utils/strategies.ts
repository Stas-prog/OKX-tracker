export type Strategy = {
    instId: string;
    buyBelow: number;
    sellAbove: number;
};

export const strategies: Strategy[] = [
    {
        instId: 'BTC-USDT',
        buyBelow: 114200,
        sellAbove: 114600,
    },
    {
        instId: 'ETH-USDT',
        buyBelow: 4400,
        sellAbove: 4500,
    },
    {
        instId: 'XRP-USDT',
        buyBelow: 2.5,
        sellAbove: 3.5,
    },
];
