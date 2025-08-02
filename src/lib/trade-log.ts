
export type TradeAction = {
    time: string;
    action: string;
    price: number;
};

let tradeHistory: TradeAction[] = [];

export const addTrade = (action: TradeAction) => {
    tradeHistory.unshift(action); // нові нагору
    if (tradeHistory.length > 20) tradeHistory.pop(); // обрізаємо довжину
};

export const getTradeHistory = () => tradeHistory;
