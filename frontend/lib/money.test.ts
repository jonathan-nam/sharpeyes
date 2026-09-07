import { describe, expect, it } from "vitest";
import {
  copyText,
  formatDollars,
  formatMoney,
  parseAmount,
  parseDollars,
  shortMoney,
} from "./money";

// The unit a price box was written in, and how each unit is said back.
//
// Everything here guards one rule: a figure and its unit never travel apart. The failure it exists
// to stop is 33334 cents rendered as 33,334 mesos, which is a thousandth of the debt shown with the
// same confidence as the right answer.

describe("reading a price box", () => {
  it("reads a leading $ as dollars and everything else as mesos", () => {
    expect(parseAmount("$1000")).toEqual({ amount: 100_000, currency: "USD" });
    expect(parseAmount("9.5b")).toEqual({ amount: 9_500_000_000, currency: "MESO" });
  });

  it("keeps a bare number meaning mesos, which is what every box already meant", () => {
    // The one thing this change must not do is re-read what people have been typing for months.
    expect(parseAmount("1000")).toEqual({ amount: 1000, currency: "MESO" });
    expect(parseAmount("970m")).toEqual({ amount: 970_000_000, currency: "MESO" });
  });

  it("takes the cents somebody typed rather than rounding them off", () => {
    expect(parseDollars("$333.34")).toBe(33_334);
    expect(parseDollars("$333.3")).toBe(33_330);
    expect(parseDollars("$1,000")).toBe(100_000);
  });

  it("refuses a third decimal instead of guessing which way it goes", () => {
    // A cent is the smallest thing a dollar sale can be. Rounding here would be the app choosing a
    // price, which is the one thing a price box must not do.
    expect(parseDollars("$12.345")).toBeNull();
    expect(parseAmount("$12.345")).toBeNull();
  });

  it("refuses the meso suffixes in dollars", () => {
    // "$1b" is a figure nobody means, and "$1k" reads as a thousand to some people and as a slip to
    // the rest. Neither is worth guessing at.
    expect(parseDollars("$1b")).toBeNull();
    expect(parseAmount("$5k")).toBeNull();
  });
});

describe("saying a figure back", () => {
  it("always shows both cents, so a price cannot be read as ten times itself", () => {
    expect(formatDollars(100_000)).toBe("$1,000.00");
    expect(formatDollars(33_330)).toBe("$333.30");
    expect(formatDollars(5)).toBe("$0.05");
  });

  it("keeps the sign outside the mark, the way a negative price is read", () => {
    expect(formatDollars(-33_334)).toBe("-$333.34");
  });

  it("dispatches on the unit rather than on the size of the number", () => {
    expect(formatMoney(100_000, "USD")).toBe("$1,000.00");
    expect(formatMoney(100_000, "MESO", true)).toBe("100,000");
    expect(shortMoney(9_500_000_000, "MESO")).toBe("9.5b");
    expect(shortMoney(100_000, "USD")).toBe("$1,000.00");
  });

  it("puts dollars on the clipboard as dollars, never as the cents they are held in", () => {
    // The figure gets pasted into whatever is moving the money. 33334 typed into that box is a
    // thousandfold overpayment.
    expect(copyText(33_334, "USD")).toBe("333.34");
    expect(copyText(9_500_000_000, "MESO")).toBe("9500000000");
  });
});
