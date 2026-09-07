// Two units one sale can be priced in, and the one place that knows how each is written.
//
// Mesos are the app's unit and always were. Dollars arrived because a drop can be sold for real
// money, which the Auction House never touches: see V76 and splitOf.
//
// NOTHING HERE CONVERTS. There is no rate, on purpose. A rate would put a meso figure next to a
// dollar one that nobody entered, and every screen that adds up sales would then be adding a
// guess to a fact. The two units are carried side by side and summed separately instead.

import { formatMesos, parseMesos, shortMesos } from "./drop-split";

export type Currency = "MESO" | "USD";

/** A figure and what it is denominated in. Cents when USD, mesos when MESO. */
export type Money = { amount: number; currency: Currency };

/**
 * Cents from what somebody typed in a price box, or null.
 *
 * Strict about the decimal: a cent is the smallest thing a dollar sale can be, so `12.345` is
 * refused rather than rounded. The k/m/b suffixes parseMesos reads are not offered here, because
 * `$1b` is a figure nobody means and `$1k` reads as a thousand to some people and as a keystroke
 * slip to the rest.
 */
export function parseDollars(input: string): number | null {
  const cleaned = input.trim().replace(/[,_\s]/g, "");
  const match = /^\$?(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match?.[1]) return null;
  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
}

/**
 * What a price box was asking for: the figure and the unit it was written in.
 *
 * The `$` is the whole switch. One box rather than a box and a currency picker, because the box
 * already reads a notation (`9.5b`) and a second control asking the same question twice is how a
 * sale ends up priced in a unit nobody chose. What was understood is echoed back under the box.
 */
export function parseAmount(input: string): Money | null {
  if (input.trim().startsWith("$")) {
    const cents = parseDollars(input);
    return cents === null ? null : { amount: cents, currency: "USD" };
  }
  const mesos = parseMesos(input);
  return mesos === null ? null : { amount: mesos, currency: "MESO" };
}

/** `$1,000.00`. Always two decimals: a price with one is a price somebody will read as ten times. */
export function formatDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${Math.floor(abs / 100).toLocaleString("en-US")}.${String(abs % 100).padStart(2, "0")}`;
}

/** A figure in its own unit. `grouped` is passed through to the meso side, which has two forms. */
export function formatMoney(value: number, currency: Currency, grouped = false): string {
  return currency === "USD" ? formatDollars(value) : formatMesos(value, grouped);
}

/**
 * The short form, for recapping something already entered. Never for a figure somebody is sending:
 * shortMesos rounds, and a rounded payout is the wrong payout.
 */
export function shortMoney(value: number, currency: Currency): string {
  return currency === "USD" ? formatDollars(value) : shortMesos(value);
}
