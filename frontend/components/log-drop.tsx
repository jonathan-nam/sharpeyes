"use client";

import { useState } from "react";
import { DropPicker } from "@/components/drop-picker";
import { dividesByCount } from "@/lib/drop-log";
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
// follows from the character and the boss. It IS resolved here for one reading: whether the pool
// has anybody else in it, which is what decides if there is a looter to ask about.

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
  /** Read only to find the pool this drop will land in, the same way logDropRoute resolves it. */
  parties: Party[];
  dropTables: DropTables;
  busy: boolean;
  /** Rejecting keeps the picked drop on screen, so a refusal can be retried without re-picking. */
  onLog: (body: LogDropBody) => void | Promise<void>;
}) {
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? "");
  const [bossKey, setBossKey] = useState("");
  const [picked, setPicked] = useState("");
  // Empty is nobody having said, which is what an unanswered drop stores. Seeded below from the
  // party's standing looter when it has one, never saved without the reader passing over it.
  const [looter, setLooter] = useState<string | null>(null);

  // The roster can arrive after this mounts, and a character deleted from another tab can leave
  // the id pointing at nobody. Falling back to the first keeps the world the table is read against
  // a real one rather than a default nobody chose.
  const character = characters.find((c) => c.id === characterId) ?? characters[0];
  if (!character) return null;

  const chosen = bosses.some((b) => b.bossKey === bossKey) ? bossKey : "";

  // The pool this will land in, when there already is one. A boss with no config yet opens a solo
  // one, whose single seat is this character, so there is no looter to name and the route refuses
  // one.
  const party = parties.find((p) => p.characterId === character.id && p.bossKey === chosen) ?? null;
  // This week's roster, not `seats`. The route accepts only a seat that RAN the week the drop falls
  // in, and a drop logged here falls in this one, so offering a departed seat would offer a looter
  // the add refuses.
  const ran = party?.members ?? [];
  // Asked only where the answer could be somebody else, and only for a drop that is ONE thing. A
  // divisible drop's stacks are the arrangement's to name one by one, and a single seat here would
  // be a second, rounder answer to a question party_loot_bundle already answers exactly.
  const asksLooter =
    party !== null &&
    ran.length > 1 &&
    picked !== "" &&
    !dividesByCount(picked, chosen, party, dropTables);
  // The standing arrangement (V36) is a suggestion, so it seeds the box and is not written for
  // anybody who never opened it: `looter` stays null until the select is touched. Seeded only when
  // that seat is still on the roster, since a designation outlives the seat it named (V36 sets it
  // null on delete but not on a week somebody sat out) and sending it would be refused.
  const standing = ran.some((m) => m.id === party?.looterMemberId) ? party!.looterMemberId : null;
  const looterValue = looter ?? standing ?? "";

  return (
    <section className="loot-pool add-panel">
      <h2 className="loot-pool-title">Add Drop</h2>

      <DropPicker
        bossKey={chosen}
        worldType={character.worldType}
        table={dropTables[chosen]}
        busy={busy}
        lead={
          <>
            {characters.length > 1 && (
              <select
                className="split-input"
                value={character.id}
                onChange={(e) => {
                  setCharacterId(e.target.value);
                  // A seat id belongs to one pool, so a picked looter cannot survive changing
                  // which pool this is. Kept, it would be sent to a party that has no such seat.
                  setLooter(null);
                }}
                aria-label="Whose drop"
              >
                {characters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            <select
              className="split-input"
              value={chosen}
              onChange={(e) => {
                setBossKey(e.target.value);
                setLooter(null);
              }}
              aria-label="Which boss"
            >
              <option value="">pick a boss</option>
              {bosses.map((boss) => (
                <option key={boss.bossKey} value={boss.bossKey}>
                  {boss.name}
                </option>
              ))}
            </select>
            {asksLooter && (
              <select
                className="split-input"
                value={looterValue}
                onChange={(e) => setLooter(e.target.value)}
                aria-label="Who looted it"
              >
                <option value="">who looted it</option>
                {ran.map((seat) => (
                  <option key={seat.id} value={seat.id}>
                    {seat.name} looted
                  </option>
                ))}
              </select>
            )}
          </>
        }
        onPick={setPicked}
        onAdd={(body) =>
          onLog({
            characterId: character.id,
            // Non-null by the time the picker submits: it refuses a body with no boss.
            bossKey: body.bossKey!,
            dropKey: body.dropKey,
            customName: body.customName,
            quantity: body.quantity,
            // Only where it was asked. Sending the seeded value off a drop that turned out to
            // divide would file a looter the log will not read and the route may refuse.
            looterMemberId: asksLooter && looterValue !== "" ? looterValue : null,
          })
        }
      />
    </section>
  );
}
