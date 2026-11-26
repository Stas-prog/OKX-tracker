
import type { Db } from "mongodb";

type InstId = string;

type StairStep = {
  pctDrop: number;
  amountPct: number;
};

export type MultiStrategy = {
  id?: string;
  name: string;
  instIds: InstId[];
  baseAllocationPct?: number;
  maxAllocationPct?: number;
  staircase?: StairStep[];
  stopLossPct?: number;
  takeProfitPct?: number;
  rebalanceIntervalSec?: number;
};

type PricePoint = {
  instId: InstId;
  price: number;
  ts?: string;
};

export type Order = {
  id?: string;
  instId: InstId;
  side: "buy" | "sell";
  price: number;
  prevPrice?: number;
  amountUsd: number;
  quantity: number;
  reason?: string;
  ts?: string;
  strategyId?: string;
};

const nowIso = () => new Date().toISOString();

async function defaultGetDb(): Promise<Db> {
  throw new Error(
    "MultiTrader: please provide getDb() implementation when constructing."
  );
}

export class MultiTrader {
  strategy: MultiStrategy;
  state: any;
  getDb: () => Promise<Db>;
  executeOrderFn?: (order: Order) => Promise<Order>;

  constructor(opts: {
    strategy: MultiStrategy;
    capitalUsd: number;
    getDb?: () => Promise<Db>;
    executeOrderFn?: (order: Order) => Promise<Order>;
  }) {
    this.strategy = {
      baseAllocationPct: 0.2,
      maxAllocationPct: 0.5,
      staircase: [
        { pctDrop: 0.005, amountPct: 0.05 },
        { pctDrop: 0.01, amountPct: 0.05 },
      ],
      stopLossPct: 0.01,
      takeProfitPct: 0.01,
      rebalanceIntervalSec: 3600,
      ...opts.strategy,
    };

    const instIds = (this.strategy.instIds || []).slice(0, 5);

    this.state = {
      capitalUsd: opts.capitalUsd,
      cashUsd: opts.capitalUsd,
      instStates: instIds.map((id) => ({
        instId: id,
        allocatedUsd: 0,
        quantity: 0,
        avgEntryPrice: 0,
        staircaseUsed: {},
        history: [],
      })),
      updatedAt: nowIso(),
      strategyId: this.strategy.id ?? this.strategy.name ?? "multi-default",
    };

    this.getDb = opts.getDb ?? defaultGetDb;
    this.executeOrderFn = opts.executeOrderFn;
  }

  // Початкова рівномірна симуляційна купівля.
  async initializePortfolio(prices: PricePoint[]) {
    const basePct = this.strategy.baseAllocationPct ?? 0.2;
    const initialOrders: Order[] = [];

    for (const inst of this.state.instStates) {
      const price = prices.find((p) => p.instId === inst.instId)?.price;

      if (!price || !Number.isFinite(price) || price <= 0) {
        continue;
      }

      const amountUsd = this.state.capitalUsd * basePct;

      if (amountUsd <= 0 || this.state.cashUsd < amountUsd) {
        continue;
      }

      const order: Order = {
        instId: inst.instId,
        side: "buy",
        price,
        amountUsd,
        quantity: amountUsd / price,
        reason: "initial_allocation",
        ts: nowIso(),
      };

      const executed = await this._executeAndApply(order);

      if (executed) {
        initialOrders.push(executed);
      }
    }

    // Запам'ятовуємо ціну для наступного розрахунку momentum.
    for (const inst of this.state.instStates) {
      const price = prices.find((p) => p.instId === inst.instId)?.price;

      if (price && Number.isFinite(price) && price > 0) {
        inst.prevPrice = price;
      }
    }

    this.state.updatedAt = nowIso();

    await this.saveState();
    await this._saveTrades(initialOrders);

    return { orders: initialOrders };
  }

  // Основний симуляційний tick.
  async onTick(prices: PricePoint[]) {
  const orders: Order[] = [];
  // ЛАБОРАТОРІЯ: для повної діагностики розкоментувати оголошення diagnostics
  // const diagnostics: any[] = [];

    // Оновлюємо історію цін.
    for (const inst of this.state.instStates) {
      const price = prices.find((p) => p.instId === inst.instId)?.price;

      if (!price || !Number.isFinite(price) || price <= 0) {
        continue;
      }

      if (inst.prevPrice == null) {
        inst.prevPrice = price;
      }

      inst.history = Array.isArray(inst.history) ? inst.history : [];
      inst.history.push(price);

      if (inst.history.length > 20) {
        inst.history.shift();
      }
    }

    // 1. Take profit / Stop loss.
    for (const inst of this.state.instStates) {
      const price = prices.find((p) => p.instId === inst.instId)?.price;

      if (!price || price <= 0 || inst.quantity <= 0) {
        continue;
      }

      const avgEntry = inst.avgEntryPrice || 0;

      if (avgEntry <= 0) {
        continue;
      }

      const pnlPct = (price - avgEntry) / avgEntry;

      const takeProfitPct = this.strategy.takeProfitPct ?? 0.08;
      const stopLossPct = this.strategy.stopLossPct ?? 0.15;

      if (takeProfitPct > 0 && pnlPct >= takeProfitPct) {
        const quantity = inst.quantity * 0.5;

        orders.push({
          instId: inst.instId,
          side: "sell",
          price,
          quantity,
          amountUsd: quantity * price,
          reason: "take_profit_partial",
          ts: nowIso(),
        });
      } else if (stopLossPct > 0 && pnlPct <= -stopLossPct) {
        orders.push({
          instId: inst.instId,
          side: "sell",
          price,
          quantity: inst.quantity,
          amountUsd: inst.quantity * price,
          reason: "stop_loss_exit",
          ts: nowIso(),
        });
      }
    }

    // 2. Staircase buys.
    for (const inst of this.state.instStates) {
      const price = prices.find((p) => p.instId === inst.instId)?.price;

      if (!price || price <= 0) {
        continue;
      }

      const referencePrice =
        inst.avgEntryPrice > 0 ? inst.avgEntryPrice : price;

      const steps = this.strategy.staircase || [];

      for (let i = 0; i < steps.length; i++) {
        if (inst.staircaseUsed?.[i]) {
          continue;
        }

        const step = steps[i];
        const drop = (referencePrice - price) / referencePrice;

        if (drop >= step.pctDrop) {
          const baseAllocation =
            (this.strategy.baseAllocationPct ?? 0.2) *
            this.state.capitalUsd;

          const buyUsd = baseAllocation * step.amountPct;

          if (buyUsd > 0 && this.state.cashUsd >= buyUsd) {
            orders.push({
              instId: inst.instId,
              side: "buy",
              price,
              amountUsd: buyUsd,
              quantity: buyUsd / price,
              reason: `staircase_buy_step_${i}`,
              ts: nowIso(),
            });
          }
        }
      }
    }

    // 3. SMA signals.
    for (const inst of this.state.instStates) {
      const price = prices.find((p) => p.instId === inst.instId)?.price;

      if (!price || price <= 0) {
        continue;
      }

      const history = (inst.history || []) as number[];

// Поточна ціна вже додана в history.
// Беремо п'ять попередніх значень, без поточного.
if (history.length < 6) {
  continue;
}

const previousFive = history.slice(-6, -1);
const sma =
  previousFive.reduce((sum, value) => sum + value, 0) / 5;
      if (sma <= 0) {
        continue;
      }

      const deviation = (price - sma) / sma;

      // Ціна нижча за SMA на 0.3% — невелика докупівля.
      if (deviation <= -0.003) {
        const buyUsd = this.state.capitalUsd * 0.02;

        if (buyUsd > 0 && this.state.cashUsd >= buyUsd) {
          orders.push({
            instId: inst.instId,
            side: "buy",
            price,
            amountUsd: buyUsd,
            quantity: buyUsd / price,
            reason: "sma_mean_revert_buy",
            ts: nowIso(),
          });
        }
      }

      // Ціна вища за SMA на 0.3% — частковий продаж.
      if (deviation >= 0.003 && inst.quantity > 0) {
        const sellUsd = Math.min(
          inst.quantity * price * 0.1,
          this.state.capitalUsd * 0.02
        );

        const quantity = sellUsd / price;

        if (quantity > 0) {
          orders.push({
            instId: inst.instId,
            side: "sell",
            price,
            amountUsd: sellUsd,
            quantity,
            reason: "sma_mean_revert_sell",
            ts: nowIso(),
          });
        }
      }
    }

    // 4. Momentum та перерозподіл.
    const momentumScores = await this.evaluateMomentum(prices);

    const sorted = Object.entries(momentumScores).sort(
      (a, b) => b[1] - a[1]
    );

    if (sorted.length > 1 && sorted[0][1] > 0.003) {
      const strongestId = sorted[0][0];

      const strongest = this.state.instStates.find(
        (item: any) => item.instId === strongestId
      );

      const currentPct = strongest
        ? strongest.allocatedUsd / this.state.capitalUsd
        : 0;

      const maxPct = this.strategy.maxAllocationPct ?? 0.5;
      const targetAddPct = Math.min(0.03, maxPct - currentPct);

      if (targetAddPct > 0) {
        let needUsd = this.state.capitalUsd * targetAddPct;

        const weakestFirst = [...this.state.instStates].sort(
          (a: any, b: any) =>
            (momentumScores[a.instId] || 0) -
            (momentumScores[b.instId] || 0)
        );

        for (const weak of weakestFirst) {
          if (weak.instId === strongestId) {
            continue;
          }

          const weakPrice = prices.find(
            (p) => p.instId === weak.instId
          )?.price;

          const strongPrice = prices.find(
            (p) => p.instId === strongestId
          )?.price;

          if (
            !weakPrice ||
            !strongPrice ||
            weakPrice <= 0 ||
            strongPrice <= 0 ||
            weak.quantity <= 0
          ) {
            continue;
          }

          const sellQuantity = Math.min(
            weak.quantity * 0.5,
            needUsd / weakPrice
          );

          const sellUsd = sellQuantity * weakPrice;

          if (sellUsd <= 0) {
            continue;
          }

          orders.push({
            instId: weak.instId,
            side: "sell",
            price: weakPrice,
            amountUsd: sellUsd,
            quantity: sellQuantity,
            reason: `reallocate_from_${weak.instId}`,
            ts: nowIso(),
          });

          orders.push({
            instId: strongestId,
            side: "buy",
            price: strongPrice,
            amountUsd: sellUsd,
            quantity: sellUsd / strongPrice,
            reason: `reallocate_to_${strongestId}`,
            ts: nowIso(),
          });

          needUsd -= sellUsd;

          if (needUsd <= 0) {
            break;
          }
        }
      }
    }

    /* ЛАБОРАТОРІЯ: повна діагностика кожної позиції.
       Для повернення діагностики в API розкоментувати цей блок
       разом із diagnostics вище та полем diagnostics у return нижче.
for (const inst of this.state.instStates) {
  const price = prices.find(
    (p) => p.instId === inst.instId
  )?.price;

  if (!price || price <= 0) {
    diagnostics.push({
      instId: inst.instId,
      error: "Ціна недоступна",
    });
    continue;
  }

  const history = (inst.history || []) as number[];

const smaReady = history.length >= 6;

const previousFive = smaReady
  ? history.slice(-6, -1)
  : [];

const sma = smaReady
  ? previousFive.reduce((a, b) => a + b, 0) / 5
  : null;

  const smaDeviation =
    sma && sma > 0 ? (price - sma) / sma : null;

  const previousPrice = inst.prevPrice ?? null;

  const momentum =
    previousPrice && previousPrice > 0
      ? (price - previousPrice) / previousPrice
      : 0;

  const avgEntry = inst.avgEntryPrice || 0;

  const pnlPct =
    avgEntry > 0
      ? (price - avgEntry) / avgEntry
      : null;

  const referencePrice = avgEntry > 0 ? avgEntry : price;
  const dropFromEntry =
    (referencePrice - price) / referencePrice;

  const staircase = (this.strategy.staircase || []).map(
    (step, index) => ({
      level: index + 1,
      thresholdPct: step.pctDrop * 100,
      currentDropPct: dropFromEntry * 100,
      reached: dropFromEntry >= step.pctDrop,
      alreadyUsed: Boolean(inst.staircaseUsed?.[index]),
    })
  );

  const takeProfitReached =
  pnlPct !== null &&
  (this.strategy.takeProfitPct ?? 0.08) > 0 &&
  pnlPct >= (this.strategy.takeProfitPct ?? 0.08);

const stopLossReached =
  pnlPct !== null &&
  (this.strategy.stopLossPct ?? 0.15) > 0 &&
  pnlPct <= -(this.strategy.stopLossPct ?? 0.15);
  const signalReasons: string[] = [];

if (!smaReady) {
  signalReasons.push("SMA: очікуємо 5 попередніх цін");
} else if (smaDeviation !== null) {
  if (smaDeviation <= -0.003) {
    signalReasons.push("SMA BUY: поріг досягнуто");
  } else if (smaDeviation >= 0.003) {
    signalReasons.push("SMA SELL: поріг досягнуто");
  } else {
    signalReasons.push(
      `SMA: потрібно відхилення ±0.3%, зараз ${(
        smaDeviation * 100
      ).toFixed(4)}%`
    );
  }
}

if (momentum > 0.003) {
  signalReasons.push("Momentum: позитивний поріг досягнуто");
} else {
  signalReasons.push(
    `Momentum: очікуємо +0.3%, зараз ${(momentum * 100).toFixed(4)}%`
  );
}

const reachedStaircase = staircase.filter(
  (step) => step.reached && !step.alreadyUsed
);

if (reachedStaircase.length > 0) {
  signalReasons.push("Staircase: є досягнутий рівень");
} else {
  signalReasons.push("Staircase: рівні докупівлі не досягнуті");
}

if (pnlPct === null) {
  signalReasons.push("TP/SL: немає ціни входу");
} else {
  if (!takeProfitReached) {
    signalReasons.push("Take Profit: поріг не досягнуто");
  }

  if (!stopLossReached) {
    signalReasons.push("Stop Loss: поріг не досягнуто");
  }
}

if (this.state.cashUsd <= 0) {
  signalReasons.push("Покупки заблоковані: немає вільних коштів");
}
  diagnostics.push({
    instId: inst.instId,
    price,
    avgEntryPrice: avgEntry,
    quantity: inst.quantity,
    allocatedUsd: inst.allocatedUsd,
    cashUsd: this.state.cashUsd,

    pnlPct:
      pnlPct === null ? null : Number((pnlPct * 100).toFixed(4)),

    momentumPct: Number((momentum * 100).toFixed(4)),
    momentumThresholdPct: 0.3,
    momentumReached: momentum > 0.003,

    sma: sma ? Number(sma.toFixed(8)) : null,
    smaDeviationPct:
      smaDeviation === null
        ? null
        : Number((smaDeviation * 100).toFixed(4)),
    smaBuyReached:
      smaDeviation !== null && smaDeviation <= -0.003,
    smaSellReached:
      smaDeviation !== null && smaDeviation >= 0.003,
    smaReady,

    dropFromEntryPct: Number((dropFromEntry * 100).toFixed(4)),
    staircase,
    signalReasons,

    takeProfitReached:
      pnlPct !== null &&
      (this.strategy.takeProfitPct ?? 0.08) > 0 &&
      pnlPct >= (this.strategy.takeProfitPct ?? 0.08),

    stopLossReached:
      pnlPct !== null &&
      (this.strategy.stopLossPct ?? 0.15) > 0 &&
      pnlPct <= -(this.strategy.stopLossPct ?? 0.15),
  });
}

    */
    // Виконуємо сигнали послідовно з повторною перевіркою балансу.
    // Execute orders sequentially with balance and position validation.
const executed: Order[] = [];

for (const order of orders) {
  const result = await this._executeAndApply(order);

  if (result) {
    executed.push(result);
  }
}

    // Оновлюємо попередні ціни після всіх розрахунків.
    for (const inst of this.state.instStates) {
      const price = prices.find((p) => p.instId === inst.instId)?.price;

      if (price && Number.isFinite(price) && price > 0) {
        inst.prevPrice = price;
      }
    }

    this.state.updatedAt = nowIso();

    await this.saveState();
    await this._saveTrades(executed);
return {
  orders: executed,
  // ЛАБОРАТОРІЯ: розкоментувати разом із блоком діагностики вище.
  // diagnostics,
};
  }

  // Зміна ціни відносно попереднього tick.
  async evaluateMomentum(
    prices: PricePoint[]
  ): Promise<Record<InstId, number>> {
    const result: Record<InstId, number> = {};

    for (const inst of this.state.instStates) {
      const price = prices.find(
        (p) => p.instId === inst.instId
      )?.price;

      const previousPrice = inst.prevPrice;

      result[inst.instId] =
        price &&
        previousPrice &&
        price > 0 &&
        previousPrice > 0
          ? (price - previousPrice) / previousPrice
          : 0;
    }

    return result;
  }

  // Перевірка та виконання одного симуляційного ордера.
  private async _executeAndApply(
    requested: Order
  ): Promise<Order | null> {
    const inst = this.state.instStates.find(
      (item: any) => item.instId === requested.instId
    );

    const price = requested.price;

    if (
      !inst ||
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(requested.amountUsd) ||
      requested.amountUsd <= 0
    ) {
      return null;
    }

    let order: Order;

    if (requested.side === "buy") {
      // Купуємо тільки на наявні вільні кошти.
      const amountUsd = Math.min(
        requested.amountUsd,
        Math.max(0, this.state.cashUsd)
      );

      if (amountUsd <= 0) {
        return null;
      }

      order = {
        ...requested,
        price,
        amountUsd,
        quantity: amountUsd / price,
        strategyId: this.state.strategyId,
        ts: nowIso(),
      };
    } else {
      // Продаємо тільки фактичну кількість монет.
      const requestedQuantity =
        requested.quantity > 0
          ? requested.quantity
          : requested.amountUsd / price;

      const quantity = Math.min(
        Math.max(0, requestedQuantity),
        Math.max(0, inst.quantity || 0)
      );

      if (quantity <= 0) {
        return null;
      }

      order = {
        ...requested,
        price,
        quantity,
        amountUsd: quantity * price,
        strategyId: this.state.strategyId,
        ts: nowIso(),
      };
    }

    const fill = await this._execute(order);

    // Обліковуємо фактичне виконання executor, а не початковий запит.
    const fillPrice = Number(fill.price);
    const requestedFillQuantity = Number(fill.quantity);

    if (
      !Number.isFinite(fillPrice) ||
      fillPrice <= 0 ||
      !Number.isFinite(requestedFillQuantity) ||
      requestedFillQuantity <= 0
    ) {
      return null;
    }

    const fillQuantity =
      order.side === "buy"
        ? Math.min(
            requestedFillQuantity,
            Math.max(0, this.state.cashUsd) / fillPrice
          )
        : Math.min(
            requestedFillQuantity,
            Math.max(0, inst.quantity || 0)
          );

    if (!Number.isFinite(fillQuantity) || fillQuantity <= 1e-12) {
      return null;
    }

    const executed: Order = {
      ...order,
      ...fill,
      instId: order.instId,
      side: order.side,
      price: fillPrice,
      quantity: fillQuantity,
      amountUsd: fillQuantity * fillPrice,
      strategyId: this.state.strategyId,
      ts: fill.ts ?? nowIso(),
    };

    await this._applyOrderToState(executed);
    return executed;
  }

  private async _execute(order: Order): Promise<Order> {
    const normalized: Order = {
      ...order,
      id: order.id ?? `sim-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 8)}`,
      ts: order.ts ?? nowIso(),
      strategyId: this.state.strategyId,
    };

    if (this.executeOrderFn) {
      try {
        const result = await this.executeOrderFn(normalized);

        return {
          ...normalized,
          ...result,
          ts: nowIso(),
          strategyId: this.state.strategyId,
        };
      } catch (error) {
        console.error("executeOrderFn failed:", error);
        throw error;
      }
    }

    return normalized;
  }

  // Оновлення позиції та балансу після симуляційної угоди.
  private async _applyOrderToState(order: Order) {
    const inst = this.state.instStates.find(
      (item: any) => item.instId === order.instId
    );

    if (!inst) {
      return;
    }

    if (order.side === "buy") {
      const amountUsd = Math.min(
        order.amountUsd,
        Math.max(0, this.state.cashUsd)
      );

      const quantity = Math.min(
        order.quantity,
        amountUsd / order.price
      );

      if (amountUsd <= 0 || quantity <= 0) {
        return;
      }

      const actualAmount = quantity * order.price;
      const previousQuantity = inst.quantity || 0;
      const previousCost =
        previousQuantity * (inst.avgEntryPrice || 0);

      const totalQuantity = previousQuantity + quantity;

      inst.quantity = totalQuantity;
      inst.avgEntryPrice =
        totalQuantity > 0
          ? (previousCost + actualAmount) / totalQuantity
          : order.price;

      inst.allocatedUsd =
        (inst.allocatedUsd || 0) + actualAmount;

      inst.lastBuyTimestamp = nowIso();

      const staircaseMatch = order.reason?.match(
        /staircase_buy_step_(\d+)/
      );

      if (staircaseMatch) {
        const stepIndex = Number.parseInt(staircaseMatch[1], 10);

        inst.staircaseUsed = {
          ...(inst.staircaseUsed || {}),
          [stepIndex]: true,
        };
      }

      this.state.cashUsd = Math.max(
        0,
        Number(this.state.cashUsd || 0) - actualAmount
      );
    } else {
      const availableQuantity = Math.max(0, inst.quantity || 0);
      const soldQuantity = Math.min(
        order.quantity,
        availableQuantity
      );

      if (soldQuantity <= 0) {
        return;
      }

      const proceeds = soldQuantity * order.price;
      const costBasisSold =
        soldQuantity * (inst.avgEntryPrice || 0);

      inst.quantity = Math.max(
        0,
        availableQuantity - soldQuantity
      );

      // allocatedUsd зберігає собівартість залишку позиції.
      inst.allocatedUsd = Math.max(
        0,
        (inst.allocatedUsd || 0) - costBasisSold
      );

      if (inst.quantity <= 1e-12) {
        inst.quantity = 0;
        inst.allocatedUsd = 0;
        inst.avgEntryPrice = 0;
      }

      inst.lastSellTimestamp = nowIso();

      // У вільні кошти надходить фактична сума продажу.
      this.state.cashUsd = Math.max(
        0,
        Number(this.state.cashUsd || 0) + proceeds
      );
    }
  }

  async saveState() {
    const db = await this.getDb();
    const collection = db.collection("multi_state");

    const strategyId =
      this.state.strategyId ||
      this.strategy.id ||
      this.strategy.name ||
      "multi-default";

    await collection.updateOne(
      { strategyId },
      {
        $set: {
          ...this.state,
          strategyId,
          updatedAt: nowIso(),
        },
      },
      { upsert: true }
    );
  }

  async loadState() {
    const db = await this.getDb();
    const collection = db.collection("multi_state");

    const strategyId =
      this.state.strategyId ||
      this.strategy.id ||
      this.strategy.name ||
      "multi-default";

    const document = await collection.findOne({ strategyId });

    if (document) {
      this.state = {
        ...this.state,
        ...(document as any),
        strategyId,
      };
    }

    return this.state;
  }

  // Зберігаємо історію окремо для кожної стратегії.
  async _saveTrades(trades: Order[]) {
    if (!trades || trades.length === 0) {
      return;
    }

    const db = await this.getDb();
    const collection = db.collection("multi_trades");

    const strategyId =
      this.state.strategyId ||
      this.strategy.id ||
      this.strategy.name ||
      "multi-default";

    const documents = trades.map((trade) => ({
      ...trade,
      strategyId,
      createdAt: trade.ts ?? nowIso(),
    }));

    await collection.insertMany(documents);
  }
}