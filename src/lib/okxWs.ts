// Легкий клієнт для OKX WebSocket з правильним ping/pong та авто-reconnect.
//
// Використання (на клієнті):
//   import { OkxWs } from "@/lib/okxWs";
//   const ws = new OkxWs({
//     url: "wss://ws.okx.com:8443/ws/v5/business", // для candles/tickers теж ок
//     onCandle: (msg) => { /* ... */ },
//     onErrorText: (txt) => setErr(txt),
//     debug: false,
//   });
//   ws.connect();
//   ws.subscribe([{ channel: "candle1m", instId: "BTC-USDT" }]);
//
// Ключові моменти:
// - Heartbeat шле РЯДОК "ping" кожні 25s (OKX так очікує). На "pong" — скидаємо watchdog.
// - НІКОЛИ не шлемо {"op": "ping"} — це дає 60012 Illegal request.
// - Backoff: 2s → 4s → 8s ... максимум 30s.
// - Є методи subscribe/unsubscribe, idempotent по ключу (channel|instId).

type OkxArg = { channel: string; instId: string };

type OkxEvent =
    | { event: "subscribe" | "unsubscribe" | "error"; code?: string; msg?: string; arg?: OkxArg }
    | { arg?: OkxArg; data?: unknown }
    | Record<string, unknown>;

type OkxWsOpts = {
    url?: string;
    debug?: boolean;
    // Колбеки
    onMessageRaw?: (raw: MessageEvent) => void;
    onAny?: (json: OkxEvent) => void;
    onErrorText?: (txt: string) => void;
    // Спеціальні канали (ми користуємось у Bot для свічок)
    onCandle?: (json: { arg: OkxArg; data: string[][] }) => void;
};

export class OkxWs {
    private url: string;
    private debug: boolean;
    private ws: WebSocket | null = null;

    private hbId: number | null = null;       // heartbeat interval
    private wdId: number | null = null;       // watchdog timeout
    private rcId: number | null = null;       // reconnect timer
    private rcDelay = 2000;                   // backoff старт

    private closedManually = false;
    private lastSubKey = "";                  // що ми підписали
    private pendingSubs = new Map<string, OkxArg>(); // збережені підписки

    // callbacks
    private onMessageRaw?: OkxWsOpts["onMessageRaw"];
    private onAny?: OkxWsOpts["onAny"];
    private onErrorText?: OkxWsOpts["onErrorText"];
    private onCandle?: OkxWsOpts["onCandle"];

    constructor(opts: OkxWsOpts = {}) {
        this.url = opts.url || "wss://ws.okx.com:8443/ws/v5/business";
        this.debug = !!opts.debug;
        this.onMessageRaw = opts.onMessageRaw;
        this.onAny = opts.onAny;
        this.onErrorText = opts.onErrorText;
        this.onCandle = opts.onCandle;
    }

    /** Підключитись (без зайвих екземплярів) */
    connect() {
        this.clearAllTimers();
        this.closedManually = false;

        if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
            // вже є підключення
            return;
        }

        try {
            this.ws = new WebSocket(this.url);
        } catch (e) {
            this.emitErr("WS init error: " + (e as Error).message);
            this.scheduleReconnect();
            return;
        }

        const ws = this.ws;

        ws.addEventListener("open", () => {
            if (this.debug) console.log("[OKX] WS open");
            this.rcDelay = 2000; // reset backoff

            // Відновлюємо всі підписки (якщо були)
            const args = Array.from(this.pendingSubs.values());
            if (args.length) {
                ws.send(JSON.stringify({ op: "subscribe", args }));
                this.lastSubKey = this.subKey(args);
            } else {
                this.lastSubKey = "";
            }

            // Heartbeat: РЯДОК "ping" (не JSON!)
            this.hbId = window.setInterval(() => {
                try {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send("ping");
                        if (this.debug) console.log("[OKX] » ping");
                    }
                } catch { }
            }, 25_000) as unknown as number;

            // Watchdog: якщо довго нема повідомлень — закриємо й перепідключимось
            this.scheduleWatchdog();
        });

        ws.addEventListener("message", (evt) => {
            // сирий
            this.onMessageRaw?.(evt);

            // OKX іноді надсилає чистий "pong"
            if (typeof evt.data === "string" && evt.data === "pong") {
                if (this.debug) console.log("[OKX] « pong");
                this.scheduleWatchdog();
                return;
            }

            let json: OkxEvent | null = null;
            try {
                json = JSON.parse(String(evt.data));
            } catch (e) {
                // Могли надіслати не-JSON, проігноруємо
                if (this.debug) console.warn("[OKX] non-JSON msg", evt.data);
                return;
            }

            // будь-який JSON → оновлюємо watchdog
            this.scheduleWatchdog();

            // error події OKX
            if ("event" in (json as any) && (json as any).event === "error") {
                const j = json as any;
                const txt = `OKX WS error: ${j.code ?? ""} ${j.msg ?? ""}`.trim();
                this.emitErr(txt || "OKX WS error");
            }

            // свічки
            if ((json as any)?.arg?.channel?.startsWith("candle") && Array.isArray((json as any).data)) {
                this.onCandle?.(json as any);
            }

            // будь-що
            this.onAny?.(json!);
        });

        ws.addEventListener("error", () => {
            this.emitErr("WebSocket error");
        });

        ws.addEventListener("close", () => {
            if (this.debug) console.log("[OKX] WS closed");
            this.clearAllTimers();
            if (!this.closedManually) this.scheduleReconnect();
        });
    }

    /** Підписка на канали; можна викликати багато разів — зливається в один набір */
    subscribe(args: OkxArg[]) {
        for (const a of args) {
            const k = this.argKey(a);
            this.pendingSubs.set(k, a);
        }
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const out = Array.from(this.pendingSubs.values());
            this.ws.send(JSON.stringify({ op: "subscribe", args: out }));
            this.lastSubKey = this.subKey(out);
            if (this.debug) console.log("[OKX] subscribe", out);
        }
    }

    /** Відписка від каналів */
    unsubscribe(args: OkxArg[]) {
        for (const a of args) {
            this.pendingSubs.delete(this.argKey(a));
        }
        if (this.ws && this.ws.readyState === WebSocket.OPEN && args.length) {
            this.ws.send(JSON.stringify({ op: "unsubscribe", args }));
            if (this.debug) console.log("[OKX] unsubscribe", args);
        }
    }

    /** Закрити вручну (без auto-reconnect) */
    close() {
        this.closedManually = true;
        this.clearAllTimers();
        try {
            this.ws?.close();
        } catch { }
        this.ws = null;
    }

    // ===== helpers =====
    private subKey(args: OkxArg[]) {
        return args.map(this.argKey).sort().join(",");
    }
    private argKey(a: OkxArg) {
        return `${a.channel}|${a.instId}`;
    }

    private scheduleWatchdog() {
        if (this.wdId) window.clearTimeout(this.wdId);
        // якщо 60s тиша — вважаємо, що конект завис, закриваємо
        this.wdId = window.setTimeout(() => {
            if (this.debug) console.warn("[OKX] Watchdog timeout → closing socket");
            try {
                this.ws?.close();
            } catch { }
        }, 60_000) as unknown as number;
    }

    private clearAllTimers() {
        if (this.hbId) {
            window.clearInterval(this.hbId);
            this.hbId = null;
        }
        if (this.wdId) {
            window.clearTimeout(this.wdId);
            this.wdId = null;
        }
        if (this.rcId) {
            window.clearTimeout(this.rcId);
            this.rcId = null;
        }
    }

    private scheduleReconnect() {
        if (this.closedManually) return;
        const delay = Math.min(this.rcDelay, 30_000);
        this.rcDelay = Math.min(delay * 2, 30_000);
        if (this.debug) console.log(`[OKX] Reconnect in ${delay} ms`);
        this.rcId = window.setTimeout(() => {
            if (navigator.onLine) this.connect();
        }, delay) as unknown as number;
    }

    private emitErr(txt: string) {
        if (this.debug) console.warn("[OKX]", txt);
        this.onErrorText?.(txt);
    }
}
