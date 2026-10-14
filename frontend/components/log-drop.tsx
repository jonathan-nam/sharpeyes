"use client";

import { useState } from "react";
import { DropPicker } from "@/components/drop-picker";
import { configFor } from "@/lib/parties";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { LogDropBody } from "@/types/loot";
import type { Party } from "@/types/party";

// The Drop Log's own form: whose character, which boss, what fell.
//
// EVERY boss is offered. It used to list only the ones that character had no party for, on the
// grounds that a partied boss's drops belong on the party. That is where they end up either way,
// because `poolFor` resolves the character's existing config when there is one and opens a solo
// config only when there is not (see logDropRoute), so the filter never prevented a wrong row. What
// it did was hide the obvious place to record a drop behind a rule nobody could see, leaving the
// bosses you run with somebody looking absent from a list of bosses.
//
// The pool is still not asked for or sent. A boss may have no pool at all yet, and which one it is
// follows from the character and the boss.
//
// The mode is not asked for either, and is read off that same pool: the drop is going into it, so
// what it may be and how many fell are the config's own answers, the same ones the pool page gives.
// A config nobody has set a mode on narrows nothing and fills nothing.
//
// One case that resolution does not speak for itself: a RETIRED config still holds the pair's slot,
// so the drop lands in it and divides by the roster it had when it came off the lists. That is a
// party you were told you no longer run, splitting a drop with people who may not have been there,
// and it is the one thing this form has to say out loud.

export function LogDrop({
  characters,
  bosses,
  parties,
  dropTables,
  busy,
  onLog,
}: {
  characters: Character[];
  bosses: Boss[];
  /**
   * Every config, retired ones included, to read the mode off the pool this drop will land in.
   */
  parties: Party[];
  dropTables: DropTables;
  busy: boolean;
  /** Rejecting keeps the picked drop on screen, so a refusal can be retried without re-picking. */
  onLog: (body: LogDropBody) => void | Promise<void>;
}) {
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? "");
  const [bossKey, setBossKey] = useState("");

  // The roster can arrive after this mounts, and a character deleted from another tab can leave
  // the id pointing at nobody. Falling back to the first keeps the world the table is read against
  // a real one rather than a default nobody chose.
  const character = characters.find((c) => c.id === characterId) ?? characters[0];
  if (!character) return null;

  const chosen = bosses.some((b) => b.bossKey === bossKey) ? bossKey : "";
  const pool = configFor(parties, character.id, chosen);

  return (
    <section className="loot-pool add-section">
      <h2 className="loot-pool-title">Add Drop</h2>

      <DropPicker
        bossKey={chosen}
        worldType={character.worldType}
        table={dropTables[chosen]}
        difficulty={pool?.difficulty}
        busy={busy}
        card
        lead={
          <>
            {characters.length > 1 && (
              <label className="add-field">
                <span>Character</span>
                <select
                  className="split-input"
                  value={character.id}
                  onChange={(e) => setCharacterId(e.target.value)}
                >
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="add-field">
              <span>Boss</span>
              <select
                className="split-input"
                value={chosen}
                onChange={(e) => setBossKey(e.target.value)}
              >
                <option value="">pick a boss</option>
                {bosses.map((boss) => (
                  <option key={boss.bossKey} value={boss.bossKey}>
                    {boss.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        }
        onAdd={(body) =>
          onLog({
            characterId: character.id,
            // Non-null by the time the picker submits: it refuses a body with no boss.
            bossKey: body.bossKey!,
            dropKey: body.dropKey,
            customName: body.customName,
            quantity: body.quantity,
          })
        }
      />
    </section>
  );
}
