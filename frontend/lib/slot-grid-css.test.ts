import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SLOT_PX, slotColumns } from "@/components/slot-grid";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

function rule(selector: string): string {
  const body = css.match(new RegExp(`\\n\\${selector} \\{([^}]*)\\}`))?.[1];
  if (body === undefined) throw new Error(`no ${selector} rule`);
  return body;
}

// The grid counts its columns in TS and the slot's floor is set in CSS. If the two disagree, the
// count fits slots narrower than the floor and the row overflows the window, or wider and a column
// is wasted.
describe("the inventory slot", () => {
  it.each([".ms-slot", ".sk-slot"])("%s floors at SLOT_PX", (selector) => {
    expect(rule(selector)).toMatch(new RegExp(`min-width:\\s*${SLOT_PX}px;`));
    expect(rule(selector)).toMatch(/box-sizing:\s*border-box;/);
  });

  it("fits whole slots and their gaps, never fewer than one", () => {
    // 16 slots and 15 gaps, the game's own width.
    expect(slotColumns(16 * SLOT_PX + 15 * 4, 4)).toBe(16);
    expect(slotColumns(16 * SLOT_PX + 15 * 4 - 1, 4)).toBe(15);
    expect(slotColumns(10, 4)).toBe(1);
  });
});
