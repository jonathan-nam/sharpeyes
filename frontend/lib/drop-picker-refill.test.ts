import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Drop Log's boss can change under a picked drop. A count left from the old boss is a wrong
// number in a box that looks filled in: Vestiges picked on one boss kept its count on the next.
//
// Read out of the source, as drop-picker-callers.test.ts does: there is no component render harness.

const picker = readFileSync(join(__dirname, "../components/drop-picker.tsx"), "utf8");

describe("the drop picker's count follows the boss", () => {
  it("fills again when the boss, mode or world changes", () => {
    expect(picker).toContain('const basis = `${bossKey}|${difficulty ?? ""}|${worldType}`;');
    const refill = picker.slice(picker.indexOf("if (filledFor !== basis) {"));
    expect(refill).toMatch(/^if \(filledFor !== basis\) \{[\s\S]*?fill\(kept\);/);
  });

  it("fills from one place for both a new drop and a new boss", () => {
    expect(picker.match(/defaultQuantity\(/g)).toHaveLength(1);
  });
});
