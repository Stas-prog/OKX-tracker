// Легкі утиліти форматування чисел/дат для UI

export const nf2 = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 8, // ціни/числа з плаваючою крапкою
});

export const nf4 = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
});

export function nf6(x: number): string {
    return (Math.round(x * 1e6) / 1e6).toFixed(6);
}

export const dtFmt = new Intl.DateTimeFormat("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
});
