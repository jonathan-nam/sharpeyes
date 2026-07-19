import { describe, expect, it } from "vitest";
import { clearsNote, recaptureWarnings } from "@/lib/boss-capture";
import type { DetectedBossClear } from "@/types/screenshot";

function clear(bossKey: string, cleared: boolean): DetectedBossClear {
  return { bossKey, displayName: bossKey, cleared };
}

describe("recaptureWarnings", () => {
  it("says nothing when the capture was clean", () => {
    expect(recaptureWarnings({ unreadableBossRows: 0, reachedBossListEnd: true })).toEqual([]);
  });

  it("reports rows the reader could not name", () => {
    const [warning] = recaptureWarnings({ unreadableBossRows: 3, reachedBossListEnd: true });
    expect(warning).toContain("3 rows");
  });

  it("counts one unreadable row in the singular", () => {
    const [warning] = recaptureWarnings({ unreadableBossRows: 1, reachedBossListEnd: true });
    expect(warning).toContain("One row");
  });

  it("reports a list that was cut off", () => {
    const [warning] = recaptureWarnings({ unreadableBossRows: 0, reachedBossListEnd: false });
    expect(warning).toContain("didn't reach the bottom");
  });

  // "We don't know whether it reached the end" is not "it was cut off". Reporting the first as the
  // second would send people back to re-capture a screenshot that was already complete.
  it("stays quiet when the reader did not say whether it reached the end", () => {
    expect(recaptureWarnings({ unreadableBossRows: 0, reachedBossListEnd: null })).toEqual([]);
  });

  it("reports both failures at once", () => {
    expect(recaptureWarnings({ unreadableBossRows: 2, reachedBossListEnd: false })).toHaveLength(2);
  });

  // A missing count is unknown, not zero, but there is nothing to tell the user either way.
  it("treats an absent unreadable count as nothing to report", () => {
    expect(recaptureWarnings({ unreadableBossRows: null, reachedBossListEnd: true })).toEqual([]);
  });
});

// The numbers here are what vision actually returns for reference-images/"boss clear menu
// sample.png" (PLANNER, 12 rows, 10 cleared, reachedListEnd false), re-measured 2026-07-19. It is
// the case worth pinning: a capture that read cleanly and is still missing 7 of the 19 bosses,
// which is indistinguishable from a complete one unless the truncation is reported.
describe("a real planner capture that was cut off", () => {
  const parse = { unreadableBossRows: 0, reachedBossListEnd: false };

  it("warns that the list was truncated even though every row it read was fine", () => {
    const warnings = recaptureWarnings(parse);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("didn't reach the bottom");
  });

  it("still reports the clears as saved, because they are", () => {
    const clears = Array.from({ length: 12 }, (_, i) => clear(`boss-${i}`, i < 10));
    expect(clearsNote(true, clears)).toBe("10 of 12 cleared. Saved.");
  });
});

describe("clearsNote", () => {
  it("counts the cleared bosses against what was read", () => {
    const clears = [clear("lotus", true), clear("damien", false), clear("seren", true)];
    expect(clearsNote(true, clears)).toBe("2 of 3 cleared. Saved.");
  });

  it("says nothing has been saved when the capture still needs review", () => {
    expect(clearsNote(false, [clear("lotus", true)])).toBe(
      "1 of 1 cleared. Nothing has been saved yet.",
    );
  });

  it("distinguishes an empty read from a zero count", () => {
    expect(clearsNote(true, [])).toBe("No boss rows were read from this screenshot.");
  });

  // Zero cleared is a real answer: the planner was read and nothing is ticked yet.
  it("reports zero cleared as a count, not as an empty read", () => {
    expect(clearsNote(true, [clear("lotus", false)])).toBe("0 of 1 cleared. Saved.");
  });
});
