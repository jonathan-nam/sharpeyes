import { describe, expect, it } from "vitest";
import { splitTitle } from "./split-title";

describe("splitTitle", () => {
  // The name in catalog/drops.yaml, quoted here so a rename there has something to break.
  it("drops the trailing Coupon the vestige's catalog name carries", () => {
    expect(splitTitle("Vestige of Erion Coupon")).toBe("Vestige of Erion Config");
  });

  it("only takes the word off the END", () => {
    // Nothing is named this today. It is here so the rule cannot quietly become "delete the word
    // coupon wherever it appears", which would maul a drop named for one.
    expect(splitTitle("Coupon of Erion")).toBe("Coupon of Erion Config");
  });
});
