"use client";

import Link from "next/link";
import { type ReactNode, useState } from "react";
import { DropPicker } from "@/components/drop-picker";
import { LootList, type StackAssignment } from "@/components/loot-list";
import { RosterInputs } from "@/components/roster-inputs";
import { RosterStrip } from "@/components/roster-strip";
import { ApiError, SAVED_BUT_STALE, StaleAfterWrite, apiAssetUrl } from "@/lib/api";
import { clearClass, clearStateLabel, nextClear } from "@/lib/boss-clears";
import type { PieceStatus } from "@/lib/drop-log";
import { type CouponsOutstanding, poolLabel } from "@/lib/loot";
import { guaranteedDrop, hasStandingRoster, otherMembers, partySizeLabel } from "@/lib/parties";
import type { Boss } from "@/types/boss";
import type { BossDrop, DropTables } from "@/types/drop";
import type { AddLootBody, Loot, SellLootBody } from "@/types/loot";
import type { Party } from "@/types/party";
import { partyHref } from "@/lib/party-path";

// One config: who ran this boss this week, and what its pool is up to.
//
// The roster is editable from here, and what it edits is THIS WEEK: a week where somebody is out
// and somebody else is in is answered on the page you are already on, and the party itself is not
// disturbed by it. Taking the boss off the week is the same kind of edit, one step further, and
// leaves the config standing for the same reason. Changing the party for good is the edit page's
// job, which is why that link is still in the header.
//
// ONE line by default. The heading, the party size and the clear state answer "what is left to do
// this week", and that is what the list is scanned for; a character with a dozen bosses was a dozen
// rows of sprites to scroll past to find out. The roster is a click away rather than gone, because
// who you are running it with is the next question, not the first.
//
// The heading is passed in because it differs per view: the boss when filed by character, the
// character when filed by boss.

// Joins the roster to compare it, so a name cannot be mistaken for the join. It was a raw NUL byte
// in the source, which had git treating this whole file as binary and every diff of it as unreadable.
const SEP = "\0";

export function PartyCard({
  party,
  heading,
  busy,
  clear,
  coupons,
  onToggleClear,
  dropTable,
  onAddDrop,
  pool,
  onSaveRoster,
  onTakeOff,
  stacks,
}: {
  party: Party;
  heading: ReactNode;
  /** THIS row's write. Fed the page's, it dimmed every row at once: the page appeared to flicker. */
  busy?: boolean;
  /**
   * Coupons of yours out of this party somebody else is holding.
   *
   * Passed in rather than worked out here: it comes off the same entries the Drop Log counts, so
   * the badge and the log cannot disagree. Zero for a party whose coupons went where they belong
   * on the night.
   *
   * Required, with no default. Every caller has the figure and a default of zero would let one of
   * them quietly draw a row as square: this feature's own history is a number added to some call
   * sites and missed on the others. See drop-log-callers.test.ts.
   */
  coupons: CouponsOutstanding;
  /**
   * The clear to draw, which is NOT always the config's own.
   *
   * On the live view it is party.cleared. On a past week the caller reads it out of that week's
   * clears instead, because /api/parties only ever answers for the period it is in. The card
   * takes it rather than reaching for party.cleared itself, so it cannot quietly draw this week's
   * state under last week's label.
   */
  clear: { cleared: boolean | null; byHand: boolean };
  /** Omitted for a read-only row: a past week is shown, not edited. */
  onToggleClear?: (cleared: boolean) => void;
  /** This party's boss's drop table, for the picker in the panel. */
  dropTable?: BossDrop[];
  /**
   * Omitted where a drop may not be added, which is any past week: the server stamps a drop with
   * today, so adding one under last week's label would file it in a week the screen is not showing.
   * Must reject when the add fails, so the row can say so.
   */
  onAddDrop?: (body: AddLootBody) => Promise<void>;
  /**
   * The pool itself, so the row can say what "1 in the pool" IS and settle it here.
   *
   * The same rows, controls and coupon split the party's own page draws, through the same
   * component: a drop sold from this panel and one sold there are one write.
   *
   * Omitted on a past week. The badge above is scoped to the week on screen and a pool is not, so
   * listing every drop under it would answer a different question from the one the badge asked.
   */
  pool?: {
    /** THIS week's drops. Narrowed by dropsInWeek, which is where the rule lives. */
    loot: Loot[];
    dropTables: DropTables;
    bossByKey: Map<string, Boss>;
    /** What a coupon row says it is. See PieceStatus. */
    pieceStatus?: PieceStatus;
    /** Why the last write to THIS pool did not land. The page holds it; the row says it. */
    error?: string | null;
    /** Per drop, so settling one does not dim the rest of the pool. */
    isSaving: (lootId: string) => boolean;
    onSell: (lootId: string, body: SellLootBody) => void;
    onUnsell: (lootId: string) => void;
    onSetTaken: (lootId: string, memberId: string | null) => void;
    onSetPaid: (lootId: string, memberId: string, paid: boolean) => void;
    onDelete: (lootId: string) => void;
  };
  /**
   * Sets who ran THIS week, or puts it back to the usual party with null.
   *
   * Omitted on a past week, which is shown and not edited: the server refuses to write one anyway,
   * because its payouts were pinned when its drops sold. Must reject when the save fails, so the
   * row can show the server's reason.
   */
  onSaveRoster?: (members: string[] | null) => Promise<void>;
  /**
   * This week's coupon nights on this boss, and who picked up which stacks of them.
   *
   * Handed to the pool rather than drawn here, so the boxes sit under the coupon row they are about
   * rather than above the picker with the row below it. Omitted on a past week, which is shown and
   * not edited, and absent on a night with nothing to hand out (one stack, or a party that folds to
   * one person).
   */
  stacks?: StackAssignment;
  /**
   * Takes this boss off the period, leaving the config standing.
   *
   * Labelled Delete, which is what it does to the ROW: the config, its seats and its pool all
   * survive, and the boss is back next period. Nothing puts it back before then, so the row is off
   * the page until the reset. Omitted on a past week, which is shown and not edited. Must reject
   * when it fails, so the row can say the boss is still on.
   */
  onTakeOff?: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  // What the Add Drop form has picked, so the split is drawn once: there while it is being typed
  // into, in the pool the rest of the time. See LootList's splitElsewhere.
  const [picked, setPicked] = useState("");
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [offError, setOffError] = useState<string | null>(null);
  // The badge, named as the party page names it: `pool` is the pool itself here.
  const poolLine = poolLabel(party, coupons);
  // The coupon this boss drops for certain at the mode this party runs, or null.
  const guaranteed = guaranteedDrop(dropTable, party.difficulty, party.worldType);
  const panelId = `party-panel-${party.id}`;
  const others = otherMembers(party);
  // A solo party has no roster, but it does have a pool, so it opens too now.
  const opens =
    others.length > 0 ||
    Boolean(pool?.loot.length) ||
    Boolean(onAddDrop) ||
    Boolean(onSaveRoster) ||
    Boolean(onTakeOff);

  const saved = others.map((m) => m.name);
  const cleaned = draft.map((m) => m.trim()).filter((m) => m !== "");
  const dirty = cleaned.join(SEP) !== saved.join(SEP);
  // Both, because `open` outlives `opens`: stepping to a past week takes the picker off a solo
  // row, and an is-open row with nothing under it is a gap below one line.
  const expanded = open && opens;

  /** Writes the week, or takes it back to the usual party with null, and closes on success. */
  async function save(members: string[] | null) {
    if (!onSaveRoster) return;
    setSaveError(null);
    try {
      await onSaveRoster(members);
      setEditing(false);
    } catch (e) {
      // The server's own reason. It is the only part of a refusal you can act on.
      setSaveError(e instanceof ApiError ? e.body : "That didn't save.");
    }
  }

  return (
    // Cleared rows step back so the list reads as what is left. Strictly `=== true`: null is "no
    // capture has said anything", which is a row that still needs an answer, not a finished one.
    <article
      className={`party-row${expanded ? " is-open" : ""}${
        clear.cleared === true ? " is-cleared" : ""
      }`}
    >
      <header className="party-row-head">
        {/* A disclosure of its own rather than the whole header, which already holds two links and
            the clear button: nesting those inside a control is not something a row can do. Absent
            on a past week for a solo config, where the panel would hold nothing at all.

            The label stopped naming the roster when the drop picker joined it below. */}
        {opens ? (
          <button
            type="button"
            className="party-row-toggle"
            aria-expanded={open}
            aria-controls={panelId}
            // Closing drops a failed add's message with it. Kept, it would greet the next open
            // still claiming a save that is no longer being attempted.
            onClick={() => {
              setOpen((o) => !o);
              setAddError(null);
              setEditing(false);
              setSaveError(null);
              setOffError(null);
            }}
          >
            <span className="party-row-chevron" aria-hidden="true" />
            <span className="visually-hidden">{open ? "Hide this party" : "Show this party"}</span>
          </button>
        ) : (
          // The frame is kept so the row's heading still lines up with its neighbours'.
          <span className="party-row-toggle is-empty" aria-hidden="true" />
        )}
        {/* The name is the way into the party, in every grouping. It used to be plain text, which
            left a party with an empty pool reachable only by clicking the word "Duo": the badge
            below is absent until something drops, and that is exactly when you go looking for
            where to add one. */}
        <Link className="party-row-heading" href={partyHref(party)}>
          {heading}
        </Link>
        <span className="party-row-label">{partySizeLabel(party.members.length)}</span>

        {/* A boss that drops vestige coupons, said with the coupon itself. A fact about the boss and
            its difficulty rather than about anything that has happened, so it does not come and go
            with what is in the pool: the pieces always drop. */}
        {guaranteed && (
          <img
            className="party-row-guaranteed"
            src={apiAssetUrl(guaranteed.iconUrl ?? "")}
            alt=""
            title={`Drops ${guaranteed.name}`}
          />
        )}

        {/* Work to do gets the line; a settled pool gets it quietly when there is none. It used
            to say nothing at all once everything was paid, which erased the pool from the row and
            left no way to tell a party with a season of drops from one that never dropped. */}
        {poolLine && (
          <Link
            className={poolLine.done ? "party-loot-summary is-done" : "party-loot-summary"}
            href={partyHref(party)}
          >
            {poolLine.text}
          </Link>
        )}

        {/* The clear is boss_clear's own row, the one the matrix draws and a planner capture
            writes, so ticking it here and uploading a planner are two ways of saying the same
            thing. Three states, not two: nothing said this period, said and not done, done.

            Without a handler it is still SHOWN, just not a control. A past week has an answer
            worth reading; what it does not have is one you may change from here. */}
        {onToggleClear ? (
          <button
            type="button"
            className={`party-clear is-${clearClass(clear.cleared)}`}
            disabled={busy}
            onClick={() => onToggleClear(nextClear(clear.cleared))}
            title={
              clear.cleared === null
                ? "No planner capture has mentioned this boss this period"
                : undefined
            }
          >
            {clearStateLabel(clear.cleared)}
          </button>
        ) : (
          <span className={`party-clear is-${clearClass(clear.cleared)} is-readonly`}>
            {clearStateLabel(clear.cleared)}
          </span>
        )}
      </header>

      {/* Who it is, and what it dropped, without leaving the list: logging a night used to be a
          page load per boss. Unmounted rather than hidden when closed, because a display:none
          panel is still focusable.

          The roster is the others only. Your own character is what the row is about, named in the
          heading or in the group above it, and drawing it again in every row is a column of the
          same sprite. */}
      {expanded && (
        <div id={panelId} className="party-row-panel">
          {/* One heading per block, in the order the panel already went in. Only where the block is
              answerable: a past week's roster is read, so naming it for the control it does not
              carry would be a heading over a list of sprites. */}
          {onSaveRoster && <h3 className="loot-group-title">Add Member</h3>}
          {editing && onSaveRoster ? (
            <>
              <RosterInputs members={draft} onChange={setDraft} />
              <div className="loot-actions">
                {/* The label carries the scope, so nothing else has to explain it. Saving here
                    changes the week, not the party. Named among three Saves in one open panel,
                    which is why the other two say what they are for too. */}
                <button
                  type="button"
                  className="party-save"
                  disabled={busy || !dirty || cleaned.length === 0}
                  onClick={() => save(cleaned)}
                >
                  Save roster for this week
                </button>
                {/* Only once the week has been spelled out: there is nothing to go back to
                    otherwise, and offering it would imply the week is currently unusual. A one-off
                    has nothing to go back to either, ever. See hasStandingRoster. */}
                {!party.usualRoster && hasStandingRoster(party) && (
                  <button
                    type="button"
                    className="party-cancel"
                    disabled={busy}
                    onClick={() => save(null)}
                  >
                    Use the usual party
                  </button>
                )}
              </div>
              {saveError && <p className="split-error">{saveError}</p>}
            </>
          ) : (
            <div className="party-row-roster">
              {others.length > 0 && <RosterStrip members={others} />}
              {/* The panel's corner, not the end of the roster. Both act on the row, and sitting
                  them after the last sprite read as being about that character. Behind the
                  disclosure either way, rather than in the header, which already holds the clear
                  button: the one control pressed every week should not sit beside the one that
                  takes the row off the page. */}
              {(onSaveRoster || onTakeOff) && (
                <div className="party-row-actions">
                  {onSaveRoster && (
                    <button
                      type="button"
                      className="party-cancel"
                      onClick={() => {
                        setDraft(saved.length > 0 ? saved : [""]);
                        setEditing(true);
                        setSaveError(null);
                      }}
                    >
                      Edit
                    </button>
                  )}
                  {onTakeOff && (
                    <button
                      type="button"
                      className="party-delete"
                      disabled={busy}
                      onClick={async () => {
                        setOffError(null);
                        try {
                          await onTakeOff();
                        } catch {
                          setOffError("That didn't save.");
                        }
                      }}
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
          {/* The row is normally gone by the time this could show, so it only ever says the take-off
              did not land. */}
          {offError && <p className="split-error">{offError}</p>}

          {onAddDrop && (
            <>
              <h3 className="loot-group-title">Add Drop</h3>
              <DropPicker
                bossKey={party.bossKey}
                worldType={party.worldType}
                table={dropTable}
                difficulty={party.difficulty}
                busy={busy ?? false}
                draft={
                  stacks && {
                    dropKey: stacks.dropKey,
                    config: stacks.config,
                    party,
                    behind: stacks.behind,
                    pickupTitle: stacks.pickup.title,
                    entitledTitle: stacks.entitledTitle,
                    onSaveShares: stacks.onSave,
                  }
                }
                onPick={setPicked}
                onAdd={async (body) => {
                  setAddError(null);
                  try {
                    await onAddDrop(body);
                  } catch (e) {
                    // A failed read-back is a stale list, not a drop that did not land. Neither
                    // rethrown nor called a failure: doing both over one held the picker loaded and
                    // the same 60 coupons were logged a second time. See StaleAfterWrite.
                    if (e instanceof StaleAfterWrite) {
                      setAddError(SAVED_BUT_STALE);
                      return;
                    }
                    setAddError("That didn't save.");
                    // Rethrown so the picker keeps what was chosen, ready to try again.
                    throw e;
                  }
                }}
              />
              {/* Beside the picker, so it cannot outlive the control it is about. */}
              {addError && <p className="split-error">{addError}</p>}
            </>
          )}
          {/* Under the picker, the order the party's own page puts them in. What the badge in the
              header is counting, item by item, with the same controls on each. */}
          {pool?.error && <p className="split-error">{pool.error}</p>}
          {pool && (
            <LootList
              party={party}
              loot={pool.loot}
              dropTables={pool.dropTables}
              bossByKey={pool.bossByKey}
              pieceStatus={pool.pieceStatus}
              stacks={stacks}
              splitElsewhere={Boolean(stacks) && picked === stacks?.dropKey}
              // The stack is what the config under it is about, so removing it from here would take
              // the split and the week's pickup with it. The pool's own page still corrects one.
              couponRemovable={false}
              editing={editing}
              panel
              busy={busy}
              isSaving={pool.isSaving}
              onSell={pool.onSell}
              onUnsell={pool.onUnsell}
              onSetTaken={pool.onSetTaken}
              onSetPaid={pool.onSetPaid}
              onDelete={pool.onDelete}
            />
          )}
          {/* One press opens the roster, the night's pickup and the split, so one press has to
              close them: the way out used to be the roster's own Cancel, which is off the top of
              the screen by the time you are in the config. Last in the panel, where the block you
              are answering is. Each Save is its own write and stands, so this only drops boxes
              nobody saved. */}
          {editing && (
            <div className="loot-actions">
              <button
                type="button"
                className="party-cancel"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setSaveError(null);
                }}
              >
                Done
              </button>
            </div>
          )}
        </div>
      )}
    </article>
  );
}
