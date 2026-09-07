import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// What the price box offers once a "$" is in it.
//
// A source test, like settlement-figure.test.ts, because there is nothing to call: these are which
// controls a component renders and which fields it puts in a body, and each goes wrong the same
// quiet way, by somebody reaching for the meso helper that has been in this file for a year.

const form = readFileSync(join(__dirname, "..", "components", "loot-sale-form.tsx"), "utf8");
const row = readFileSync(join(__dirname, "..", "components", "loot-row.tsx"), "utf8");

describe("the one price box, in two notations", () => {
  it("reads the box for its unit rather than assuming mesos", () => {
    expect(form).toContain("const money = parseAmount(price);");
    expect(form).toContain('const inDollars = money?.currency === "USD";');
    // The meso-only reader is gone from this file. Left in beside parseAmount it would be the one
    // somebody edits, and it reads "$1000" as nothing at all.
    expect(form).not.toContain("parseMesos");
  });

  it("says the box takes both, that being the only thing on screen that could", () => {
    expect(form).toContain('placeholder="9.5b or $1000"');
  });

  it("echoes the figure back in the unit it was read as", () => {
    // What makes the "$" a visible switch rather than a hidden one: type it and the preview under
    // the box turns into $1,000.00.
    expect(form).toContain("formatMoney(money.amount, money.currency, true)");
  });

  it("sends the cents and no meso figure", () => {
    expect(form).toContain("amount: inDollars ? 0 : money.amount,");
    expect(form).toContain("usdCents: inDollars ? money.amount : undefined,");
  });
});

describe("the controls a dollar sale does not get", () => {
  it("drops Gross, since no Auction House took a cut off a PayPal transfer", () => {
    expect(form).toContain(
      '{!inDollars && <option value="LISTED">{labelled ? "Gross" : "listed for"}</option>}',
    );
    // And coerces, not merely hides. A basis already sitting in the state when the "$" is typed
    // would be submitted with its option off screen, and the server refuses that pairing.
    expect(form).toContain(
      'const basis = inDollars && amountBasis === "LISTED" ? "RECEIVED" : amountBasis;',
    );
  });

  it("drops the split, the two methods being one arithmetic at a rate of zero", () => {
    expect(form).toContain("{shared && !inDollars && (");
    expect(form).toContain('const method = inDollars ? "LAZY" : splitMethod;');
  });

  it("does not name a split method on a sold row that was never asked for one", () => {
    expect(row).toContain('currency === "USD" ? "" : `, ${loot.splitMethod === "FAIR"');
  });
});
