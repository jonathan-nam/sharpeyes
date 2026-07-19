"use client";

import { cellState, formatPeriod, indexClears } from "@/lib/boss-clears";
import type { Boss, BossClearsByCharacter } from "@/types/boss";
import type { Character } from "@/types/character";

// Bosses on the ROWS, characters on the columns.
//
// The other way round does not fit: 19 bosses against a 794px column leaves ~36px per boss, which
// is not enough for a name and forces rotated headers. Characters are the smaller axis for almost
// everyone, and it is also how the same information is kept by hand today (reference-images/boss
// matrix.png), so the layout matches how it is already read.

// The planner itself groups by cadence (MONTHLY / WEEKLY / DAILY, see reference-images/boss
// planner.png), and the grouping is load-bearing here rather than decorative: two bosses in one
// matrix are not counting the same span of time, and a check under DAILY means something quite
// different from a check under MONTHLY.
const CADENCE_ORDER = ["MONTHLY", "WEEKLY", "DAILY"];

// On a cold load neither the catalog nor the roster has arrived, so the loading state has nothing
// real to lay out. These stand in: the shape is right (one monthly, a run of weeklies, two dailies,
// which is what the catalog actually looks like) even though the exact counts are not known client
// side until /api/bosses answers. Being a row or two out for one round-trip is a cosmetic
// difference; rendering an empty table is not.
const SKELETON_BOSSES: Boss[] = [
  { bossKey: "sk-monthly", name: "", reset: "MONTHLY" },
  ...Array.from({ length: 8 }, (_, i) => ({
    bossKey: `sk-weekly-${i}`,
    name: "",
    reset: "WEEKLY",
  })),
  ...Array.from({ length: 2 }, (_, i) => ({ bossKey: `sk-daily-${i}`, name: "", reset: "DAILY" })),
];

const SKELETON_CHARACTERS = Array.from({ length: 4 }, (_, i) => ({ id: `sk-char-${i}`, name: "" }));

// The column headers double as the upload's character picker, rather than a second roster strip
// above the table. Every character is already a column here, so a carousel would be the same list
// twice, and pinning by clicking the column puts "where will this go" in the data itself.
export function BossMatrix({
  bosses,
  characters,
  clearsByCharacter,
  loading,
  selectedId,
  onSelectCharacter,
}: {
  bosses: Boss[];
  characters: Pick<Character, "id" | "name">[];
  clearsByCharacter: BossClearsByCharacter;
  loading?: boolean;
  selectedId?: string | null;
  onSelectCharacter?: (id: string) => void;
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

  const cadences = CADENCE_ORDER.filter((c) => rows.some((b) => b.reset === c));

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
            {columns.map((character) => {
              const selected = !loading && character.id === selectedId;
              return (
                <th
                  key={character.id}
                  className={`boss-char-head${selected ? " is-selected" : ""}`}
                  scope="col"
                  title={character.name}
                  aria-selected={onSelectCharacter && !loading ? selected : undefined}
                >
                  {loading ? (
                    <span className="skeleton sk-line" />
                  ) : onSelectCharacter ? (
                    <button
                      type="button"
                      className="boss-char-pick"
                      onClick={() => onSelectCharacter(character.id)}
                    >
                      {character.name}
                      <span className="visually-hidden">
                        {selected
                          ? ", selected. A screenshot dropped below is saved to them."
                          : ", select to save a screenshot to them"}
                      </span>
                    </button>
                  ) : (
                    character.name
                  )}
                </th>
              );
            })}
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

      {!loading && (
        <p className="boss-legend">
          <span className="boss-key is-cleared">✓</span> cleared
          <span className="boss-key is-pending">·</span> not yet
          <span className="boss-key is-unseen" /> no capture this period
        </p>
      )}
    </div>
  );
}
