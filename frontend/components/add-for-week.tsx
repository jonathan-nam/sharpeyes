"use client";

import { useState } from "react";
import { RosterInputs } from "@/components/roster-inputs";
import { difficultyLabel } from "@/lib/boss-difficulty";
import { bossesWithoutConfig, namedSeats } from "@/lib/parties";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { Party, SavePartyBody } from "@/types/party";

// A boss for this week and no other. The edit page makes STANDING parties, on this week and every
// week after, which is the wrong shape for a night somebody talks you into: it would be on the list
// for ever, and taking it off again is a second job.
//
// A card of its own, the shape the Drop Log's Add Drop has: a form above the list of what it has
// already recorded. It was a button that opened one, which kept the form out of the way at the
// price of having to be found first.
//
// The Add is a + on the end of the row, so the boxes and the thing that submits them read as one
// control. Its label ("Add for this week") is the tooltip, which is the only place the week is
// still said.
//
// The roster is RosterInputs, the same control the edit page and Party View's row use, and not one
// box: a night somebody talks you into is a pug, and a pug is five other people. One box left this
// the only form in the app that could not state a whole party, so the roster had to be finished
// afterwards on the row it had just made.
//
// Without sprites, as Party View's row is. The frame is drawn for an empty seat too, so at 96px a
// card that opens on one blank box would open 112px tall and stay that way, and this is a form
// rather than a roster being checked. The datalist inside RosterInputs is the typo guard here.

export function AddForWeek({
  characters,
  bosses,
  parties,
  busy,
  error,
  onAdd,
}: {
  characters: Character[];
  bosses: Boss[];
  /** The period's configs, so a boss already on it is not offered twice. */
  parties: Party[];
  busy: boolean;
  error: string | null;
  onAdd: (body: SavePartyBody) => Promise<void>;
}) {
  const [characterId, setCharacterId] = useState("");
  const [bossKey, setBossKey] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [members, setMembers] = useState<string[]>([""]);

  // Opening on the first character rather than on a prompt to choose one, as the edit page does.
  const chosen = characterId || characters[0]?.id || "";
  const available = chosen ? bossesWithoutConfig(parties, bosses, chosen) : [];
  const difficulties = bosses.find((b) => b.bossKey === bossKey)?.difficulties ?? [];
  const named = namedSeats(members);

  // Every box answered, since the + says nothing about what is missing. A boss that offers no
  // difficulties has nothing to answer there. Somebody, rather than every seat: an empty box is a
  // seat opened and not used, and the + would otherwise go dead the moment one was added.
  const ready =
    chosen !== "" &&
    bossKey !== "" &&
    named.length > 0 &&
    (difficulties.length === 0 || difficulty !== "");

  function reset() {
    setBossKey("");
    setDifficulty("");
    setMembers([""]);
  }

  async function add() {
    await onAdd({
      characterId: chosen,
      bossKey,
      members: named,
      difficulty: difficulty === "" ? null : difficulty,
      oneOff: true,
    });
    reset();
  }

  return (
    <section className="loot-pool add-section">
      <h2 className="loot-pool-title">Add Party</h2>

      <form
        className="add-card"
        onSubmit={(e) => {
          e.preventDefault();
          void add();
        }}
      >
        <div className="add-fields">
          <label className="add-field">
            <span>Character</span>
            <select
              className="split-input"
              value={chosen}
              disabled={busy}
              onChange={(e) => {
                setCharacterId(e.target.value);
                // The bosses on offer are that character's, so a boss chosen for the last one is
                // not one this one can necessarily run.
                reset();
              }}
            >
              {characters.map((character) => (
                <option key={character.id} value={character.id}>
                  {character.name}
                </option>
              ))}
            </select>
          </label>

          <label className="add-field is-wide">
            <span>Boss</span>
            <select
              className="split-input"
              value={bossKey}
              disabled={busy || available.length === 0}
              onChange={(e) => {
                setBossKey(e.target.value);
                setDifficulty("");
              }}
            >
              <option value="">
                {available.length === 0 ? "every boss is on this week" : "choose..."}
              </option>
              {available.map((boss) => (
                <option key={boss.bossKey} value={boss.bossKey}>
                  {boss.name}
                </option>
              ))}
            </select>
          </label>

          {/* Unlike the edit page, empty is not an answer here: a night you are recording is a
              night you already ran, so the mode is known. */}
          <label className="add-field">
            <span>Difficulty</span>
            <select
              className="split-input"
              value={difficulty}
              disabled={busy || difficulties.length === 0}
              onChange={(e) => setDifficulty(e.target.value)}
            >
              <option value="">choose...</option>
              {difficulties.map((d) => (
                <option key={d} value={d}>
                  {difficultyLabel(d)}
                </option>
              ))}
            </select>
          </label>

          {/* The server refuses a party with nobody else in it, on purpose: that is a solo run. So
              there is no such thing as an empty one to fill in afterwards.

              A group of boxes rather than one, so not a <label>: RosterInputs names each seat
              itself, and a label over several inputs points at whichever it liked. */}
          <div className="add-field is-roster" role="group" aria-label="Members">
            <span>Members</span>
            <RosterInputs members={members} onChange={setMembers} disabled={busy} />
          </div>

          <button
            type="submit"
            className="party-save add-plus"
            title="Add for this week"
            aria-label="Add for this week"
            disabled={busy || !ready}
          >
            <span aria-hidden="true">+</span>
          </button>
        </div>

        {error && <p className="split-error">{error}</p>}
      </form>
    </section>
  );
}
