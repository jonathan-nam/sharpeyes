"use client";

import { cellState, formatPeriod, indexClears } from "@/lib/boss-clears";
import type { Boss, BossClearsByCharacter } from "@/types/boss";
import type { Character } from "@/types/character";

// Bosses on the ROWS, characters on the columns.
//
// The other way round does not fit: 16 bosses against a 794px column leaves ~50px per boss, which
// is not enough for a name and forces rotated headers. Characters are the smaller axis for almost
// everyone, and it is also how the same information is kept by hand today (test-fixtures/boss
// matrix.png), so the layout matches how it is already read.

// The planner itself groups by cadence (MONTHLY / WEEKLY / DAILY, see test-fixtures/boss
// planner.png), and the grouping is load-bearing here rather than decorative: two bosses in one
// matrix are not counting the same span of time, and a check under MONTHLY means something quite
// different from a check under WEEKLY. DAILY stays in the order though the tracker no longer keeps
// dailies: the list is filtered to the cadences actually present, so it costs nothing and is what
// this would need if they ever come back.
const CADENCE_ORDER = ["MONTHLY", "WEEKLY", "DAILY"];

// On a cold load neither the catalog nor the roster has arrived, so the loading state has nothing
// real to lay out. These stand in: the shape is right (one monthly and a run of weeklies, which is
// what the catalog actually looks like) even though the exact counts are not known client side
// until /api/bosses answers. Being a row or two out for one round-trip is a cosmetic difference;
// rendering an empty table is not.
const SKELETON_BOSSES: Boss[] = [
  { bossKey: "sk-monthly", name: "", reset: "MONTHLY" },
  ...Array.from({ length: 8 }, (_, i) => ({
    bossKey: `sk-weekly-${i}`,
    name: "",
    reset: "WEEKLY",
  })),
];

const SKELETON_CHARACTERS = Array.from({ length: 4 }, (_, i) => ({
  id: `sk-char-${i}`,
  name: "",
  spriteImgUrl: null,
}));

export function BossMatrix({
  bosses,
  characters,
  clearsByCharacter,
  loading,
  historyWeek,
}: {
  bosses: Boss[];
  characters: Pick<Character, "id" | "name" | "spriteImgUrl">[];
  clearsByCharacter: BossClearsByCharacter;
  loading?: boolean;
  // Set when showing a past week rather than the current period. See the cadence filter below.
  historyWeek?: string | null;
}) {
  // Same table either way, so the loading and loaded layouts cannot drift apart.
  const rows = loading && bosses.length === 0 ? SKELETON_BOSSES : bosses;
  const columns = loading && characters.length === 0 ? SKELETON_CHARACTERS : characters;

  // Indexed per character; see lib/boss-clears.ts for why the three cell states are three.
  const byCharacter = new Map<string, Map<string, boolean>>();
  for (const [characterId, clears] of Object.entries(clearsByCharacter)) {
    byCharacter.set(characterId, indexClears(clears));
  }

  // The period each cadence is currently in, taken from the data rather than recomputed. The reset
  // boundary lives in the backend (bosses/BossPeriod.kt); working it out again here would be a
  // second copy of the one number in this feature that must not be wrong.
  const periodByCadence = new Map<string, string>();
  for (const clears of Object.values(clearsByCharacter)) {
    for (const clear of clears) {
      const boss = bosses.find((b) => b.bossKey === clear.bossKey);
      if (boss && !periodByCadence.has(boss.reset))
        periodByCadence.set(boss.reset, clear.periodStart);
    }
  }

  // A past week can only answer for weekly bosses. Seven daily periods sit inside one week, so
  // there is no single "was Zakum cleared that week" to put in a cell, and a week can straddle two
  // months. Drawing one of several true answers as if it were the only one is the confident wrong
  // number this project exists to avoid, so the other two cadences are absent instead. The backend
  // returns weekly rows only for these views (see weeklyClearsFor); this keeps the empty MONTHLY
  // and DAILY bands off the table to match.
  const shown = historyWeek ? CADENCE_ORDER.filter((c) => c === "WEEKLY") : CADENCE_ORDER;
  const cadences = shown.filter((c) => rows.some((b) => b.reset === c));

  return (
    <div
      className="boss-matrix"
      role="status"
      aria-label={loading ? "Loading boss clears" : undefined}
    >
      <table className="boss-table">
        <thead>
          <tr>
            <th className="boss-col-head" scope="col">
              Boss
            </th>
            {columns.map((character) => (
              <th key={character.id} className="boss-char-head" scope="col" title={character.name}>
                {/* The slot is drawn whether or not there is a sprite, so a roster where only some
                    characters have one does not end up with ragged column heads. */}
                {loading ? (
                  <span className="skeleton sk-face" />
                ) : character.spriteImgUrl ? (
                  <span
                    className="boss-char-sprite sprite-face"
                    style={{ backgroundImage: `url("${character.spriteImgUrl}")` }}
                    aria-hidden="true"
                  />
                ) : (
                  <span className="boss-char-sprite is-empty" aria-hidden="true" />
                )}
                {loading ? <span className="skeleton sk-line" /> : character.name}
              </th>
            ))}
          </tr>
        </thead>

        {cadences.map((cadence) => (
          <tbody key={cadence}>
            <tr className="boss-cadence-row">
              <th className="boss-cadence" scope="colgroup" colSpan={columns.length + 1}>
                {cadence}
                {periodByCadence.has(cadence) && (
                  <span className="boss-period">
                    since {formatPeriod(periodByCadence.get(cadence)!)}
                  </span>
                )}
              </th>
            </tr>

            {rows
              .filter((boss) => boss.reset === cadence)
              .map((boss) => (
                <tr key={boss.bossKey}>
                  <th className="boss-name" scope="row">
                    {loading ? <span className="skeleton sk-line" /> : boss.name}
                  </th>
                  {columns.map((character) => {
                    if (loading) {
                      return (
                        <td key={character.id} className="boss-cell">
                          <span className="skeleton sk-cell" />
                        </td>
                      );
                    }
                    const state = cellState(byCharacter.get(character.id), boss.bossKey);
                    return (
                      <td key={character.id} className={`boss-cell is-${state}`}>
                        {/* The glyph is decorative; the text is what a screen reader gets, and
                            "not reported" is deliberately not "not cleared". */}
                        <span aria-hidden="true">
                          {state === "cleared" ? "✓" : state === "pending" ? "·" : ""}
                        </span>
                        <span className="visually-hidden">
                          {state === "cleared"
                            ? `${boss.name} cleared by ${character.name}`
                            : state === "pending"
                              ? `${boss.name} not yet cleared by ${character.name}`
                              : `${boss.name} not reported for ${character.name}`}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
          </tbody>
        ))}
      </table>

      {!loading && historyWeek && cadences.length === 0 && (
        <p className="boss-empty-week">No planner was captured this week.</p>
      )}

      {!loading && (
        <>
          <p className="boss-legend">
            <span className="boss-key is-cleared">✓</span> cleared
            <span className="boss-key is-pending">·</span> not yet
            <span className="boss-key is-unseen" /> no capture this period
          </p>
          {/* Said out loud rather than left as an absence: a reader who knows Zakum is in the
              catalog should find out why it is missing here, not assume the week lost it. */}
          {historyWeek && (
            <p className="boss-history-note">
              Weekly bosses only. A past week holds seven daily resets and can span two months, so
              neither has a single answer for it.
            </p>
          )}
        </>
      )}
    </div>
  );
}
