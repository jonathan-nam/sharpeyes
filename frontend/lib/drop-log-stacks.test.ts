import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Drop Log's Add Drop carries a coupon night's Looted and Entitled blocks, but only for a party
// running this week: anywhere else the form records a run with nobody else (see logDropRoute), and
// blocks for a party that is not running would split a solo kill with people who were not there.
//
// Read out of the source, as run-order-stacks.test.ts does: there is no component render harness.

const form = readFileSync(join(__dirname, "../components/log-drop.tsx"), "utf8");
const layout = readFileSync(join(__dirname, "../app/bosses/drops/(log)/layout.tsx"), "utf8");

describe("the Drop Log's coupon blocks", () => {
  it("draws them only for a party running this week", () => {
    expect(form).toContain(
      "const party = pool && !pool.solo && !pool.retired && !pool.skippedThisPeriod ? pool : undefined;",
    );
    expect(form).toContain("party &&\n    shareConfig(");
    expect(form).toContain("draft={draft}");
  });

  it("files the night they answer in that party's pool, and nothing else", () => {
    expect(form).toContain("draft && body.dropKey === draft.dropKey");
    expect(form).toContain("? onLogToParty(draft.party, body)");
    expect(layout).toContain('onLog={(body) => logDrop("/api/parties/loot", body)}');
    expect(layout).toContain(
      "onLogToParty={(party, body) => logDrop(`/api/parties/${party.id}/loot`, body)}",
    );
  });
});
