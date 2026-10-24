import { describe, expect, it } from "vitest";
import { committedGolden, goldenText } from "@/lib/golden";

// localeCompare's answers for the backend port, which orders strings with ICU (money/Js.kt). Every
// shape the money code sorts: names in any case and punctuation, ISO dates and timestamps with and
// without fractions, uuids, holder keys.

const WORDS = [
  "alice",
  "Alice",
  "ALICE",
  "bob",
  "Bob",
  "Bobby",
  "bob2",
  "Bob 2",
  "b-ob",
  "b_ob",
  "D'Arcy",
  "Mc-Gee",
  "mcgee",
  "Zed",
  "zed",
  "you",
  "You",
  "Ünther",
  "unther",
  "Pellmoor",
  "Thornwick",
  "thornwick",
  "2026-08-01",
  "2026-08-01T10:00:00Z",
  "2026-08-01T10:00:00.123Z",
  "2026-08-01T10:00:00.123456Z",
  "2026-08-01T09:59:59.999Z",
  "2026-10-21",
  "2026-09-30",
  "0050a1b2-0000-4000-8000-00000000000a",
  "0050A1B2-0000-4000-8000-00000000000a",
  "acd816fc-1111-4000-8000-000000000001",
  "28760ee5-2222-4000-8000-000000000002",
  "person:0050a1b2",
  "person:acd816fc",
  "character:bob",
  "character:Bob",
  "self",
  "",
  " ",
  "-",
  ".",
  "1",
  "10",
  "2",
  "a1",
  "a10",
  "a2",
];

describe("collation golden fixture", () => {
  it("is what localeCompare answers today", () => {
    const pairs = WORDS.flatMap((a) =>
      WORDS.map((b) => ({ input: [a, b], output: Math.sign(a.localeCompare(b)) })),
    );
    const text = goldenText("frontend/lib/collation.golden.test.ts", pairs);
    expect(committedGolden("collation.json", text) === text, "run with UPDATE_GOLDEN=1").toBe(true);
  });
});
