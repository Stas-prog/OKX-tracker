import { listStrategies } from "./strategiesRepo";
import { loadState } from "./stateRepo";
import { saveState } from "./stateRepo";

let state: any;
let usdt = state?.budgetUsd || 1000;
let btc = state?.budgetBtc || 0.01;
let lastPrice = 0;
let position = "none";
let side = "hold";
let pnl = 0;
let k = 0;
let ks = 0;
let pl = 0;
let mn = 0;
let del = 1;
let stepsUsd = [1]; 
let stepsBtc = [1];
let buyBelow = 0.005;
let sellAbove = -0.005;
let lastTxn: LastTxn = null;

type VTStateDoc = {
  state: {budgetUsd: number, budgetBtc: number};
  instId: string; 
  budgetUsd: number;
  budgetBtc: number;                
  updatedAt: string; 
};

type LastTxn = {
  instId: string; 
  side: "buy" | "sell" | "hold";
  del: number;
  price: number;
  pnl: number;
  lastPrice: number;
  position: "none" | "long"
  amountUsd: number;
  quantity: number;
  stepsUsd?: number[];
  stepsBtc?: number[];
  buyBelow?: number;
  sellAbove?: number;
  ts: string;
} | null;

async function saveSt(): Promise<void> {
  await saveState({
    instId: "BTC_USDT",
    budgetUsd: usdt,
    budgetBtc: btc,
    updatedAt: new Date().toISOString(),}); 
}
 

const strategies = await listStrategies();
console.log("Loaded strategies:", strategies);
stepsUsd = strategies[0]?.staircaseBuyUsd || stepsUsd;
stepsBtc = strategies[0]?.staircaseSellFractions || stepsUsd;
buyBelow = strategies[0]?.buyBelow || buyBelow;
sellAbove = strategies[0]?.sellAbove || sellAbove;
console.log("Steps USD:", stepsUsd);
console.log("Steps BTC:", stepsBtc);
console.log("Steps BTC:", buyBelow);
console.log("Steps BTC:", sellAbove);

state = await loadState("BTC_USDT");

console.log("Wallet state", state)


export function getWallet() {
  return { usdt, btc, lastPrice, position, side, pnl };
}

export function getLastTxn(): LastTxn {
  return lastTxn;
}


export function updateWallet(price: number) {
  if (lastPrice === 0) {
    lastPrice = price;
    lastTxn = null;
    return "⏳ Очікуємо старт...";
  }

  let change = (price - lastPrice) / lastPrice;
  const pnlp = usdt + (btc * price) - 2180;

  // if(change > 0){
  //   pl +=1;
  // } else if (change < 0){ 
  //   mn +=1;
  // }

  // if(mn >= 1377){
  //   lastPrice = price;
  //   mn = 0;
  // }  

  // if(pl >= 1377){
  //   pl = 0;
  //   lastPrice = price;
  // }


console.log("change", change)

  if(usdt <= 0) { 
    if(change > 0){
    change = change * -1;
    }else{
      change = change * -1;
    }
    //   if(lastPrice - price >= 15){
    //   lastPrice = price;  
    // }
  };
  
  if(btc <= 0) { 
    if(change < 0){
    change = change * -1;
    }else{
      change = change * 20;
  }
  
}


   
  console.log(change)
  
  while (change > 0 && change > buyBelow && usdt > 10 && (stepsUsd ? k < stepsUsd.length : true)) {
    const amountToSpend = stepsUsd && stepsUsd[k] ? stepsUsd[k] * usdt : usdt * 0.1; 
    console.log("amountToSpend", amountToSpend)
    if (amountToSpend > usdt) {
      break;
    };
    const btcToBuy = amountToSpend / price;
    usdt -= amountToSpend;
    btc += btcToBuy;
    lastPrice = price;
    position = "long";
    pnl = pnlp;
    side = "buy";
    k += 1;
    ks = 0;
    del += 1;


    lastTxn = {
      instId: "BTC_USDT",
      side: "buy",
      del: del,
      price,
      position: "long",
      lastPrice: lastPrice,
      pnl: pnlp,
      amountUsd: amountToSpend,
      quantity: btcToBuy,
      ts: new Date().toISOString(),
    };

    saveSt();

    return `🟢 Куплено ${btcToBuy.toFixed(5)} BTC по ${price}`;
  }

  while (0 > change && change < sellAbove && btc > 0.0001 && ks < stepsBtc.length) {
    const btcToSell = stepsBtc && stepsBtc[ks] ? stepsBtc[ks] * btc : btc * 0.1; 
    console.log("btcToSell", btcToSell)
    if (btcToSell > btc) {
      break;
    };
    const usdtFromSell = btcToSell * price;
    btc -= btcToSell;
    usdt += usdtFromSell;
    lastPrice = price;
    position = "long";
    pnl = pnlp;
    side = "sell";
    ks += 1;
    k = 0;
    del += 1; 

    lastTxn = {
      instId: "BTC_USDT",
      side: "sell",
      del: del,
      price,
      position: "long",
      lastPrice: lastPrice,
      pnl: pnlp,
      amountUsd: usdtFromSell,    
      quantity: btcToSell,         
      ts: new Date().toISOString(),
    };

    saveSt();

    return `🔴 Продано ${btcToSell.toFixed(5)} BTC по ${price}`;
  }
      
  lastTxn = null;
  side = "hold";
  
  return `🟡 Нічого не робимо. Зміна: ${(change * 100).toFixed(2)}%`;
}
