"use client";

import { DifficultySelect } from "@/components/difficulty-select";
import { apiAssetUrl } from "@/lib/api";
import { cadenceLabel } from "@/lib/boss-clears";
import { hasGuaranteedDrop } from "@/lib/parties";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";

// One character's routine: every boss in the catalog, ticked if they run it, and the mode they run
// it at where that decides what a clear can say.
//
// The whole list rather than the exceptions, because the question being answered is "what does this
// character run" and you cannot answer it from a column of the matrix without reading down sixteen
// rows. Ticking it here also means the answer is visible before it is saved, which a cell in the
// grid could not do: there, a mark on a boss already cleared this week would have been written and
// then drawn over by the tick.
//
// The mode is the one input a clear cannot supply for itself. Coupons are per (boss, difficulty) and
// no boss drops them at every mode it has, so Extreme Kalos gives 180 and Chaos Kalos none off the
// same tick. It is asked here, once, rather than per clear. A party keeps its own mode on its config,
// beside the roster and the split, so a partied boss is left to that.

// Same grouping the matrix uses, and the planner itself. A monthly boss and a weekly one are not
// counting the same span of time, so they do not sit in one undivided list.
const CADENCE_ORDER = ["MONTHLY", "WEEKLY", "DAILY"];

export function BossRoutineEditor({
  characterName,
  bosses,
  dropTables,
  skipped,
  lockedBossKeys,
  soloDifficulty,
  isSaving,
  onToggle,
  onDifficulty,
}: {
  characterName: string;
  bosses: Boss[];
  /** Each boss's drop table, for whether a mode decides anything about what a clear files. */
  dropTables: DropTables;
  /** Boss keys this character does not run. Everything else in the catalog is ticked. */
  skipped: Set<string>;
  /**
   * Bosses that cannot be un-ticked: a party config already says this character runs them.
   *
   * Drawn locked rather than refused after the click. The config is (character, boss, difficulty,
   * who with), which is the same claim in more detail, so the way to say they stopped running it
   * is to delete the config.
   */
  lockedBossKeys: Set<string>;
  /** The mode each boss run alone is run at, by boss key. Absent is nobody having said. */
  soloDifficulty: Map<string, string | null>;
  /** Whether THIS box's write is in flight. One flag for the page greyed the whole list on one tick. */
  isSaving: (bossKey: string) => boolean;
  onToggle: (bossKey: string, runs: boolean) => void;
  /** Empty means nobody has said, which is what the pool goes back to. */
  onDifficulty: (bossKey: string, difficulty: string | null) => void;
}) {
  const cadences = CADENCE_ORDER.filter((c) => bosses.some((b) => b.reset === c));

  return (
    <section className="routine">
      {cadences.map((cadence) => (
        <div key={cadence} className="routine-group">
          <h2 className="routine-cadence">{cadenceLabel(cadence)}</h2>
          <ul className="routine-list">
            {bosses
              .filter((boss) => boss.reset === cadence)
              .map((boss) => {
                const runs = !skipped.has(boss.bossKey);
                const locked = lockedBossKeys.has(boss.bossKey);
                // Only where it decides something: a boss the character runs alone, whose table
                // carries an amount at some mode. Everywhere else the select would change nothing.
                const asks = runs && !locked && hasGuaranteedDrop(dropTables[boss.bossKey]);
                return (
                  <li key={boss.bossKey} className={`routine-row${runs ? "" : " is-skipped"}`}>
                    <label className="routine-label">
                      <input
                        type="checkbox"
                        className="routine-check"
                        checked={runs}
                        disabled={locked || isSaving(boss.bossKey)}
                        onChange={(e) => onToggle(boss.bossKey, e.target.checked)}
                      />
                      {boss.iconUrl ? (
                        <img className="boss-portrait" src={apiAssetUrl(boss.iconUrl)} alt="" />
                      ) : (
                        <span className="boss-portrait is-empty" aria-hidden="true" />
                      )}
                      <span className="routine-name">{boss.name}</span>
                      {/* Why this one cannot be un-ticked, on the row it applies to. Anywhere else
                          it would be a note about a disabled box you have to go looking for. */}
                      {locked && <span className="routine-locked">has a party</span>}
                    </label>
                    {/* Outside the label, not in it: a click on a control the label owns would
                        toggle the checkbox as well. */}
                    {asks && (
                      <DifficultySelect
                        difficulties={boss.difficulties}
                        value={soloDifficulty.get(boss.bossKey) ?? ""}
                        label={`Difficulty ${characterName} runs ${boss.name} at`}
                        disabled={isSaving(boss.bossKey)}
                        onChange={(picked) =>
                          onDifficulty(boss.bossKey, picked === "" ? null : picked)
                        }
                      />
                    )}
                  </li>
                );
              })}
          </ul>
        </div>
      ))}
    </section>
  );
}
