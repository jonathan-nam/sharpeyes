"use client";

import { useState } from "react";
import { DifficultySelect } from "@/components/difficulty-select";
import { KNOWN_CHARACTERS_ID, KnownCharacters } from "@/components/known-characters";
import { RosterInputs } from "@/components/roster-inputs";
import { apiAssetUrl } from "@/lib/api";
import { MAX_MINUTES, parseMinutes } from "@/lib/boss-minutes";
import { rotatingDropsAt } from "@/lib/loot-rotation";
import { moveLines } from "@/lib/roster-conflict";
import { bossesWithoutConfig, standingMembers, standingParties } from "@/lib/parties";
import { splitTitle } from "@/lib/split-title";
import {
  couponsOf,
  evenStacks,
  formatStacks,
  parseStacks,
  sharesFromStacks,
  stacksAddUp,
  stacksFromShares,
  stacksKey,
  sumOfStacks,
} from "@/lib/stacks";
import type { Boss } from "@/types/boss";
import type { BossDrop, DropTables } from "@/types/drop";
import type { Party, PartyMember, RosterMove, SavePartyBody } from "@/types/party";

/** The one drop a party has to decide how to divide. See catalog/drops.yaml. */
const VESTIGE = "vestige-of-erion";

// One character's parties: a row per boss they do not solo, and who they run it with.
//
// The character leads because that is how the question gets asked ("what does mechyfechy run Kalos
// with"), and a boss with no row is a boss that character solos. Nothing has to be said for those,
// which is what keeps this down to the handful of lines that matter.

export function PartyConfigEditor({
  characterId,
  characterName,
  parties,
  bosses,
  dropTables,
  knownCharacters,
  spriteFor,
  isSaving,
  adding,
  errorFor,
  addError,
  movesFor,
  addMoves,
  onConfirmMove,
  onCancelMove,
  onSave,
  onDelete,
  onPutBack,
}: {
  characterId: string;
  characterName: string;
  parties: Party[];
  bosses: Boss[];
  /** Each boss's drop table, for the piece and stack counts an uneven split is measured in. */
  dropTables: DropTables;
  /** Characters named anywhere already, for the datalist. Picking beats remembering a spelling. */
  knownCharacters: string[];
  /** The sprite for a name as typed, for the roster boxes. See lib/sprite-by-name. */
  spriteFor: (name: string) => string | null;
  /**
   * Whether THIS config's write is in flight, by its id. Fed one flag for the page, saving a single
   * config dimmed every row's buttons at once.
   */
  isSaving: (partyId: string) => boolean;
  /** The add form's own write. Adding one party does not lock the rows above it. */
  adding: boolean;
  /**
   * Why THIS config's write was refused, by its id.
   *
   * Per row for the same reason `isSaving` is. One message for the page rendered after the LAST
   * row, so a refusal named the row you were on and appeared below the ones you were not: measured
   * at 382px under the clicked Save button, editing the sixth of seven parties in a 757px viewport.
   * Off screen, so the save read as having done nothing.
   */
  errorFor: (partyId: string) => string | null;
  /** The add form's own refusal. */
  addError: string | null;
  /**
   * The move THIS row's last save was refused for, by its id, or null.
   *
   * Somebody in the roster is in another party for this boss. That used to be the end of it, and
   * on a duo there was no way through at all: taking the one other member out leaves a solo run,
   * which is not a party, so the only route was removing the party by hand first. Answering here
   * does both halves in one save. See lib/roster-conflict.ts.
   */
  movesFor: (partyId: string) => RosterMove[] | null;
  /** The add form's own, for the same reason it has its own refusal. */
  addMoves: RosterMove[] | null;
  onConfirmMove: () => void;
  onCancelMove: () => void;
  onSave: (body: SavePartyBody, partyId?: string) => void;
  onDelete: (party: Party) => void;
  /** Puts a boss back on the period Party View took it off. Only that direction lives here. */
  onPutBack: (party: Party) => void;
}) {
  const [addingBoss, setAddingBoss] = useState("");
  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  // The one-offs are not rows here, so they do not hold their boss back from the select either:
  // asking for one as a standing party takes over the config it already has, pool and all, which is
  // how a night that keeps happening becomes an arrangement. See takeOverParty.
  const standing = standingParties(parties);
  const available = bossesWithoutConfig(standing, bosses, characterId);

  return (
    <section className="configs">
      {standing.length === 0 && (
        <p className="party-hint">
          {characterName} has no parties yet. A boss they solo needs none, so add only the ones they
          run with somebody.
        </p>
      )}

      {standing.map((party) => (
        <ConfigRow
          key={party.id}
          party={party}
          boss={bossByKey.get(party.bossKey) ?? null}
          drops={dropTables[party.bossKey] ?? []}
          spriteFor={spriteFor}
          busy={isSaving(party.id)}
          error={errorFor(party.id)}
          moves={movesFor(party.id)}
          onConfirmMove={onConfirmMove}
          onCancelMove={onCancelMove}
          onSave={(members, difficulty, minutes, looterName, shares) =>
            onSave(
              {
                characterId,
                bossKey: party.bossKey,
                members,
                difficulty,
                minutes,
                looterName,
                shares,
              },
              party.id,
            )
          }
          onDelete={() => onDelete(party)}
          onPutBack={() => onPutBack(party)}
        />
      ))}

      <div className="loot-actions">
        <select
          className="split-input"
          value={addingBoss}
          onChange={(e) => setAddingBoss(e.target.value)}
          aria-label={`Add a boss for ${characterName}`}
          disabled={available.length === 0}
        >
          <option value="">
            {available.length === 0 ? "every boss has a party" : "add a boss..."}
          </option>
          {available.map((boss) => (
            <option key={boss.bossKey} value={boss.bossKey}>
              {boss.name}
            </option>
          ))}
        </select>
        <AddParty
          busy={adding || addingBoss === ""}
          difficulties={bossByKey.get(addingBoss)?.difficulties ?? []}
          onAdd={(member, difficulty) => {
            onSave({ characterId, bossKey: addingBoss, members: [member], difficulty });
            setAddingBoss("");
          }}
          knownCharacters={knownCharacters}
        />
      </div>
      {addError && <p className="split-error">{addError}</p>}
      <MoveConfirm
        moves={addMoves}
        busy={adding}
        onConfirm={onConfirmMove}
        onCancel={onCancelMove}
      />
    </section>
  );
}

/**
 * Adding a party takes the boss AND the first person in one go.
 *
 * The server refuses a party with nobody else in it, on purpose: that is a solo run, and a solo
 * run is not a party. So there is no such thing as an empty row to fill in afterwards.
 */
function AddParty({
  busy,
  difficulties,
  onAdd,
  knownCharacters,
}: {
  busy: boolean;
  /** The chosen boss's modes, empty until a boss is chosen. */
  difficulties: string[];
  onAdd: (member: string, difficulty: string | null) => void;
  knownCharacters: string[];
}) {
  const [member, setMember] = useState("");
  const [difficulty, setDifficulty] = useState("");
  return (
    <>
      <DifficultySelect
        difficulties={difficulties}
        value={difficulty}
        label="Difficulty for the new party"
        disabled={busy}
        onChange={setDifficulty}
      />
      <input
        className="split-input"
        value={member}
        list={KNOWN_CHARACTERS_ID}
        onChange={(e) => setMember(e.target.value)}
        placeholder="with who?"
        aria-label="First member of the new party"
        maxLength={40}
      />
      <button
        type="button"
        className="party-save"
        disabled={busy || member.trim() === ""}
        onClick={() => {
          onAdd(member.trim(), difficulty === "" ? null : difficulty);
          setMember("");
          setDifficulty("");
        }}
      >
        Add party
      </button>
      <KnownCharacters names={knownCharacters} />
    </>
  );
}

/**
 * What the move costs, then the button that does it.
 *
 * What is said is the effect and only the effect: who leaves whose party, and, where it is true,
 * that the party goes with them. The rule behind it (a character is in one party per boss) is why
 * the question exists and is not itself worth a line on screen.
 *
 * In place of Save rather than beside it. The save that raised this is the one being answered, so
 * offering both would be two buttons for one decision.
 */
function MoveConfirm({
  moves,
  busy,
  onConfirm,
  onCancel,
}: {
  moves: RosterMove[] | null;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!moves) return null;
  return (
    <>
      {moveLines(moves).map((line) => (
        <p className="split-error" key={line}>
          {line}
        </p>
      ))}
      <div className="loot-actions">
        <button type="button" className="party-save" onClick={onConfirm} disabled={busy}>
          Move
        </button>
        <button type="button" className="party-cancel" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
      </div>
    </>
  );
}

/**
 * How long this party takes on its boss, door to door.
 *
 * Empty is a real answer and stays one: a config nobody has timed gets the flat estimate on Run
 * Order, marked there as a guess. It is asked per config rather than per boss because the boss
 * cannot answer for it, the same Hard Lucid being twenty minutes for one party and five for a
 * stronger one.
 *
 * The box holds text rather than a number, so half-typed input is refused at the Save button
 * instead of being silently rounded into something. See parseMinutes.
 */
function RunMinutes({
  value,
  label,
  disabled,
  onChange,
}: {
  value: string;
  label: string;
  disabled?: boolean;
  onChange: (minutes: string) => void;
}) {
  return (
    <span className="config-minutes">
      <input
        className="split-input config-minutes-input"
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_MINUTES}
        step={5}
        value={value}
        aria-label={label}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="config-minutes-unit" aria-hidden="true">
        min
      </span>
    </span>
  );
}

function ConfigRow({
  party,
  boss,
  drops,
  spriteFor,
  busy,
  error,
  moves,
  onConfirmMove,
  onCancelMove,
  onSave,
  onDelete,
  onPutBack,
}: {
  party: Party;
  boss: Boss | null;
  /** This boss's drop table, for the counts an uneven split is measured in. */
  drops: BossDrop[];
  /** The sprite for a name as typed, for the roster boxes. See lib/sprite-by-name. */
  spriteFor: (name: string) => string | null;
  busy: boolean;
  /** Why this row's last write was refused. Shown under its own buttons, not the page's. */
  error: string | null;
  /** The move this row's last save was refused for, offered in place of its Save button. */
  moves: RosterMove[] | null;
  onConfirmMove: () => void;
  onCancelMove: () => void;
  onSave: (
    members: string[],
    difficulty: string | null,
    minutes: number | null,
    looterName: string | null,
    shares: Record<string, number>,
  ) => void;
  onDelete: () => void;
  onPutBack: () => void;
}) {
  // The party itself, not the week being shown: a week already written into keeps the roster it
  // ran, so editing off that one would promote its guest and drop the member who sat it out.
  const saved = standingMembers(party).map((m) => m.name);
  const savedDifficulty = party.difficulty ?? "";
  const savedMinutes = party.minutes === null ? "" : String(party.minutes);
  // Your own character's seat, which the roster inputs leave out because it IS the config.
  const ownName = party.seats.find((s) => s.characterId === party.characterId)?.name ?? "";
  // The seat that loots, held as a NAME: it is what the save sends, and it survives the seat being
  // renamed in the same edit.
  const savedLooter = party.seats.find((s) => s.id === party.looterMemberId)?.name ?? "";
  const [members, setMembers] = useState<string[]>(saved.length > 0 ? saved : [""]);
  const [difficulty, setDifficulty] = useState(savedDifficulty);
  const [minutes, setMinutes] = useState(savedMinutes);
  const [looter, setLooter] = useState(savedLooter);
  // What each seat takes, by name, as typed. Keyed by name for the same reason the looter is: it
  // is what the save sends, and it survives a seat being renamed in this same edit.
  // What each seat is entitled to, in STACKS, as typed. Keyed by name for the same reason the looter
  // is: it is what the save sends, and it survives a seat being renamed in this same edit.
  //
  // A ratio is what gets STORED, and it cannot say "four stacks and two" on its own: those stacks
  // depend on how many fell. So the boxes are filled from the ratio and the boss's stack count
  // together, and an unanswered config opens on the even split rather than on blanks. See lib/stacks.
  // Optional all the way down. lib/cache.ts hands back whatever shape the API had when this page
  // last fetched, so a tab open across a deploy that adds a field gets a drop with no `bundles` at
  // all, and `bundles[difficulty]` throws on the read. The world is one of those added fields, so a
  // stale cached shape reads as nothing to divide rather than as the wrong world's pile.
  const world = party.worldType;

  /**
   * The drop this party's split is measured in, at a given mode, or none.
   *
   * The coupon where the boss drops one, because that is what the boxes have always counted and the
   * one ratio governs everything the party divides. Otherwise the Eternal piece, which is the whole
   * reason this is a function: Chaos Kalos and every fragment mode drop something that divides and
   * no coupon at all, so those parties had no way to set a split, while the rotation went on
   * dividing by a ratio nobody could reach.
   */
  const dividingAt = (mode: string): BossDrop | undefined => {
    if (mode === "") return undefined;
    const coupon = drops.find((d) => d.dropKey === VESTIGE);
    if ((coupon?.pieces?.[world]?.[mode] ?? 0) > 0) return coupon;
    return rotatingDropsAt(drops, mode, world)[0];
  };

  const savedMode = party.difficulty ?? "";
  const savedBundles = dividingAt(savedMode)?.bundles?.[world]?.[savedMode];
  const savedStacks = (bundleCount: number | undefined): Record<string, string> => {
    const seats = party.seats.filter((s) => !s.guest);
    if (bundleCount === undefined || seats.length === 0) return {};
    const halves =
      stacksFromShares(
        seats.map((s) => s.shares),
        bundleCount,
      ) ?? evenStacks(bundleCount, seats.length);
    return Object.fromEntries(seats.map((s, i) => [s.name, formatStacks(halves[i] ?? 0)]));
  };
  const [entitled, setEntitled] = useState<Record<string, string>>(savedStacks(savedBundles));
  const parsed = parseMinutes(minutes);
  /**
   * Whether anybody has typed in the boxes.
   *
   * What decides whether the save DERIVES the ratio or passes the stored one through. A ratio that
   * does not land on whole half-stacks cannot be shown in these boxes at all, so they open on the
   * even split instead: 2:1 over 14 pieces opens at 7 and 7. Deriving from that on every save meant
   * editing a party's MINUTES quietly rewrote its 2:1 into 1:1. Rare on coupons, where six stacks
   * absorb most ratios; the ordinary case on pieces.
   */
  const stacksDirty = stacksKey(entitled) !== stacksKey(savedStacks(savedBundles));
  const dirty =
    members.join(" ") !== saved.join(" ") ||
    difficulty !== savedDifficulty ||
    minutes !== savedMinutes ||
    looter !== savedLooter ||
    stacksDirty;
  // The roster as it is being edited, not as it was saved, so somebody added in this same edit can
  // be picked and a renamed seat keeps whatever it was designated for.
  const rosterNames = [ownName, ...members.map((m) => m.trim())].filter((name) => name !== "");
  /** What each seat is on now, by name, for a save that must not restate a deal it cannot show. */
  const savedShares = new Map(party.seats.filter((s) => !s.guest).map((s) => [s.name, s.shares]));
  const attributed = standingMembers(party).filter((m) => m.personName);

  /**
   * What the boss drops and in how many stacks, which is what the boxes are measured against.
   *
   * Both absent until there is something exact to say: the figures are per (boss, difficulty), so a
   * config with no mode chosen, a boss that drops no coupons, or a mode nobody has counted the stacks
   * for get nothing rather than a number standing in for one. No stack count, no boxes.
   */
  const dividing = dividingAt(difficulty);
  const bundlesForEdit = dividing?.bundles?.[world]?.[difficulty];
  const total = dividing?.pieces?.[world]?.[difficulty];
  /** Whether there is anything to divide here, which is the only state the boxes are drawn in. */
  const showBoxes = bundlesForEdit !== undefined && total !== undefined;
  /** The typed entitlements, in halves, in roster order. Null anywhere one is not an answer. */
  const halves = rosterNames.map((name) => parseStacks(entitled[name] ?? ""));
  // Only where the boxes are ON SCREEN. A blank box is not an answer, and every box is blank when
  // none are drawn, so this was true for every party whose boss divides nothing: Black Mage and
  // friends had Save disabled for ever, on a form with no boxes to fix.
  const badStacks = showBoxes && halves.some((n) => n === null);
  /**
   * Whether the boxes come to the stacks that fell.
   *
   * The refusal this replaced a ratio for. Two stacks each on a boss that drops three is a deal that
   * cannot happen, and a ratio could not say it: it went in as 1:1 and entitled everybody to 1.5.
   * Unchecked where the stack count is unknown, which is a config with no mode written down.
   */
  const addsUp =
    bundlesForEdit === undefined || (!badStacks && stacksAddUp(halves as number[], bundlesForEdit));
  /** Coupons per stack, which is 1 for every piece but Hard Star's. */
  const stackSize = showBoxes ? total! / bundlesForEdit! : 1;
  /** What the boxes are counting. A piece cannot change hands; a coupon can. */
  const unit = dividing?.untradeable ? "pieces" : "coupons";

  return (
    <article className="config-row">
      <header className="config-head">
        {boss?.iconUrl && <img className="boss-portrait" src={apiAssetUrl(boss.iconUrl)} alt="" />}
        <h3 className="config-boss">{boss?.name ?? party.bossKey}</h3>
        {/* Where a boss that is off Party View is found again. The row is off that page entirely, so
            this is the only place it can be said, and it belongs beside Remove: one is the week, the
            other is for good.

            Every row here is a standing party, so this is always undoing something you did. Running
            a spent one-off again is Party View's Add Party, which offers that boss back. */}
        {party.skippedThisPeriod && (
          <button type="button" className="party-save" onClick={onPutBack} disabled={busy}>
            Put back this week
          </button>
        )}
        <button type="button" className="party-delete" onClick={onDelete} disabled={busy}>
          Remove
        </button>
      </header>

      {/* A row asks four things, so each block is headed with the one it asks. Unheaded, a select,
          a number box and a column of names read as one form, and the first two were sitting in the
          boss's own heading line. */}
      <div className="config-fields">
        <div className="config-section">
          <h4 className="loot-group-title is-config">Difficulty</h4>
          <DifficultySelect
            difficulties={boss?.difficulties ?? []}
            value={difficulty}
            label={`Difficulty for ${boss?.name ?? party.bossKey}`}
            disabled={busy}
            onChange={setDifficulty}
          />
        </div>
        <div className="config-section">
          <h4 className="loot-group-title is-config">Duration</h4>
          <RunMinutes
            value={minutes}
            label={`Minutes for ${boss?.name ?? party.bossKey}`}
            disabled={busy}
            onChange={setMinutes}
          />
        </div>
      </div>

      <div className="config-section">
        <h4 className="loot-group-title is-config">Members</h4>
        <RosterInputs members={members} onChange={setMembers} spriteFor={spriteFor} />
        {/* Whose character each one is, when the people list says so. Read-only here: it is an
            account-wide fact, kept on the People page rather than per config. */}
        {attributed.length > 0 && (
          <p className="party-hint">
            {attributed.map((m) => `${m.name} is ${m.personName}'s`).join(", ")}
          </p>
        )}
      </div>

      {/* What each seat is entitled to, in STACKS.

          One input each, and nothing else. It used to be a select of the three arrangements a party
          makes, with share boxes behind the third: "one member always takes more" said the shape of a
          deal without saying the deal, and a ratio could not say "four and two" at all, so a party on
          4:2 went in as even and was quietly entitled to three each.

          Halves are allowed because three stacks between two people is 1.5 each, which is the
          commonest night there is. What is stored is still a ratio: see lib/stacks.

          Named from the roster being edited, not the saved seats, so somebody added in this same edit
          gets a box.

          Absent on a boss that drops no coupons, and on one whose mode nobody has written down: the
          stacks that fell are what these numbers have to add up to. */}
      {/* Asked only where there is something to argue over: a count AND a stack count for this
          boss, at this mode, in this world. Black Mage drops none at any mode and Chaos Kalos no
          coupons at that one, so both would otherwise be asked how to split nothing.

          These two reads ARE the guard. There used to be a third condition in front of them, a
          `dropsVestige` that asked the same question again and got it wrong: it read
          `pieces[difficulty]` from a map the world had since been put on top of (V63), so it
          returned a whole world's map, which is never undefined and never a number. Comparing that
          to undefined is legal TypeScript, so the compiler said nothing and the block vanished from
          every party with a mode set. Do not reintroduce a second answer to a question these two
          already answer. */}
      {showBoxes && (
        <div className="config-section config-panel">
          {/* Built from the drop's own name, not a fixed one: Chaos Kalos and every fragment mode
              divide an Eternal piece here and no coupon at all. See splitTitle for the suffix the
              catalog name carries and this title does not want.

              The art beside it for the same reason the pool rows carry it: a coupon is recognised
              by its sprite before its name is read. Nothing is drawn where the catalog has no art
              for the drop, rather than a broken frame. */}
          <div className="config-panel-head">
            {dividing?.iconUrl && (
              <img className="loot-icon" src={apiAssetUrl(dividing.iconUrl)} alt="" />
            )}
            <h4 className="loot-group-title is-config">
              {dividing ? splitTitle(dividing.name) : ""}
            </h4>
          </div>
          <div className="config-vestige">
            <span className="config-share-drop">
              {/* The stack size only where it is a fact worth carrying. Most pieces fall one to a
                stack, and "5 in 5 stacks of 1" says the same thing three times; Hard Star's 18 in 6
                stacks of 3 is the number the boxes are actually measured in. */}
              {stackSize > 1
                ? `${total} in ${bundlesForEdit} stacks of ${stackSize}`
                : `${total} ${unit}`}
            </span>
            <div className="config-shares">
              {rosterNames.map((name, i) => (
                <label className="config-share" key={name}>
                  {name}
                  <input
                    className="split-input"
                    value={entitled[name] ?? ""}
                    onChange={(e) => setEntitled({ ...entitled, [name]: e.target.value })}
                    placeholder="1"
                    inputMode="decimal"
                    aria-label={`Stacks ${name} is entitled to each week`}
                    disabled={busy}
                  />
                  {/* What the stacks come to in coupons, which is the number the ledger states debts
                    in. Only where the box reads: half a typed answer is not a count. */}
                  {halves[i] !== null && stackSize > 1 && (
                    <span className="config-share-stacks">
                      {`${couponsOf(halves[i]!, total!, bundlesForEdit!)} ${unit}`}
                    </span>
                  )}
                </label>
              ))}
            </div>
            {/* Said, not silently corrected. A deal that does not come to what fell leaves stacks
              nobody is entitled to, and the ledger cannot say who owes them. */}
            {!addsUp && (
              <p className="split-error">{`These come to ${
                badStacks ? "an unreadable number" : sumOfStacks(halves) / 2
              } of ${bundlesForEdit} stacks.`}</p>
            )}
          </div>
        </div>
      )}

      {dirty && !moves && (
        <div className="loot-actions">
          <button
            type="button"
            className="party-save"
            disabled={busy || !parsed.ok || badStacks}
            onClick={() =>
              parsed.ok &&
              !badStacks &&
              addsUp &&
              onSave(
                members.map((m) => m.trim()).filter((m) => m !== ""),
                difficulty === "" ? null : difficulty,
                parsed.minutes,
                looter === "" ? null : looter,
                // ALWAYS sent, never omitted. writeMembers reads a missing name as one share, so a
                // save that left this out would quietly reset every seat the party had agreed
                // otherwise for. Whole roster every time, the way the members list is.
                // Stacks in, RATIO out, in lowest terms. Lossless while the boxes add up, which is
                // the only state that saves: the stacks come back as bundles * shares / total. See
                // lib/stacks.
                // Derived from the boxes only where somebody typed in them. Untouched, the
                // stored share is passed straight back, because the boxes cannot always SHOW it:
                // see stacksDirty. A name the party has never had takes one share, which is what
                // the server would have defaulted it to anyway.
                stacksDirty
                  ? Object.fromEntries(
                      rosterNames.map((name, i) => [
                        name,
                        sharesFromStacks(halves.map((n) => n ?? 0))[i] ?? 1,
                      ]),
                    )
                  : Object.fromEntries(
                      rosterNames.map((name) => [name, savedShares.get(name) ?? 1]),
                    ),
              )
            }
          >
            Save
          </button>
          <button
            type="button"
            className="party-cancel"
            disabled={busy}
            onClick={() => {
              setMembers(saved.length > 0 ? saved : [""]);
              setLooter(savedLooter);
              setEntitled(savedStacks(savedBundles));
              setDifficulty(savedDifficulty);
              setMinutes(savedMinutes);
            }}
          >
            Revert
          </button>
        </div>
      )}
      <MoveConfirm moves={moves} busy={busy} onConfirm={onConfirmMove} onCancel={onCancelMove} />
      {error && <p className="split-error">{error}</p>}
    </article>
  );
}
