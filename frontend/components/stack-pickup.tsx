"use client";

import { useState } from "react";
import { holderKey, holderOf } from "@/lib/vestige-ledger";
import {
  type StackDrop,
  type Tally,
  assignedStacks,
  draftUnanswered,
  openingCounts,
  parseWholeStacks,
  pieceTallies,
  stacksToSave,
} from "@/lib/vestige-pickup";
import type { Party } from "@/types/party";

// Who actually picked up which stacks of THIS night's coupons, under the row that says what fell.
//
// The config above it is the deal; this is what happened. Both are needed, because the debt is the
// gap between them and neither can be worked out from the other.
//
// Whole stacks only. A half belongs to the deal, where it means an average across weeks; nobody
// bends down for half a stack on the night.
//
// Read-only until the panel's own Edit, and read-only it shows what was RECORDED and nothing else.
// The boxes open on a looter or a balanced guess when nobody has said, and drawing that as a resting
// state would put a pickup nobody entered on screen as though it had happened.
//
// A screen that only STATES the night passes no onSave, and read-only is all it can ever be.

export function StackPickup({
  drop,
  party,
  editing,
  busy,
  onSave,
}: {
  drop: StackDrop;
  party: Party;
  editing: boolean;
  busy: boolean;
  /** The night's arrangement, by seat id. Absent is read-only. */
  onSave?: (lootId: string, bundles: Record<string, number>) => Promise<void>;
}) {
  if (!editing || !onSave) return <PickupSummary drop={drop} />;
  return <PickupBoxes drop={drop} party={party} busy={busy} onSave={onSave} />;
}

/** What one seat's stacks come to, in pieces. */
function tallyLabel(tally: Tally): string {
  return `${tally.took} took, ${tally.due} due`;
}

/** What the night says at rest: who took what, or that nobody has said. */
function PickupSummary({ drop }: { drop: StackDrop }) {
  // Against the recorded arrangement, or against nothing. `due` does not depend on the counts, so
  // the second still carries every seat's entitlement and simply has nobody taking anything.
  const tallies = pieceTallies(drop, drop.recorded ? drop.counts : {});
  return (
    <div className="config-shares">
      {drop.seats.map((seat) => {
        const tally = tallies.get(holderKey(holderOf(seat))) ?? { took: 0, due: 0 };
        return (
          <span className="config-share" key={seat.id}>
            {seat.name}
            {/* Only what is known. With nothing recorded, what anybody took is exactly what this
                screen cannot say, and what they are due is true either way. */}
            <span className="config-share-stacks">
              {drop.recorded ? tallyLabel(tally) : `${tally.due} due`}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function PickupBoxes({
  drop,
  party,
  busy,
  onSave,
}: {
  drop: StackDrop;
  party: Party;
  busy: boolean;
  onSave: (lootId: string, bundles: Record<string, number>) => Promise<void>;
}) {
  // Text rather than numbers, so a half-typed box is refused at Save instead of snapping to
  // something nobody meant.
  const [boxes, setBoxes] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      Object.entries(openingCounts(drop, party)).map(([id, n]) => [id, String(n)]),
    ),
  );
  const [refusal, setRefusal] = useState<string | null>(null);

  const parsed = Object.fromEntries(
    drop.seats.map((s) => [s.id, parseWholeStacks(boxes[s.id] ?? "")]),
  );
  const readable = drop.seats.every((s) => parsed[s.id] !== null);
  const whole = Object.fromEntries(drop.seats.map((s) => [s.id, parsed[s.id] ?? 0]));
  const assigned = assignedStacks(whole);
  const adds = readable && assigned === drop.bundles;
  const tallies = adds ? pieceTallies(drop, whole) : null;

  async function save() {
    setRefusal(null);
    try {
      await onSave(drop.lootId, stacksToSave(whole));
    } catch (e) {
      setRefusal(e instanceof Error ? e.message : "That didn't save.");
    }
  }

  return (
    <>
      <div className="config-shares">
        {drop.seats.map((seat) => {
          const tally = tallies?.get(holderKey(holderOf(seat))) ?? null;
          return (
            <label className="config-share" key={seat.id}>
              {seat.name}
              <input
                className="split-input"
                value={boxes[seat.id] ?? ""}
                onChange={(e) => setBoxes({ ...boxes, [seat.id]: e.target.value })}
                placeholder="0"
                inputMode="numeric"
                aria-label={`Stacks ${seat.name} picked up`}
                disabled={busy}
              />
              <span className="config-share-stacks">{tally ? tallyLabel(tally) : ""}</span>
            </label>
          );
        })}
      </div>

      <div className="loot-actions">
        <button
          type="button"
          className="party-save"
          disabled={busy || !adds}
          onClick={() => void save()}
        >
          Save pickup
        </button>
        {readable && !adds && (
          <span className="split-error">
            {assigned} of {drop.bundles} stacks placed
          </span>
        )}
        {!readable && <span className="split-error">whole stacks only</span>}
      </div>

      {refusal && <p className="split-error">{refusal}</p>}
    </>
  );
}

/**
 * The same boxes for a night that has NOT been logged yet, inside the form that is about to log it.
 *
 * Controlled, and with no Save of its own: there is no drop to save against, and the counts go out
 * with the POST that creates one. State lives in the picker for that reason, so what is submitted
 * and what is on screen are one value rather than two that have to be kept level.
 *
 * The arithmetic hint is the recorded boxes' own, word for word. It is the same rule (every stack
 * has to be placed) and the server enforces it either way, so saying it differently here would be
 * two wordings for one refusal.
 */
export function StackPickupDraft({
  drop,
  boxes,
  busy,
  onChange,
}: {
  drop: StackDrop;
  boxes: Record<string, string>;
  busy: boolean;
  onChange: (boxes: Record<string, string>) => void;
}) {
  const parsed = Object.fromEntries(
    drop.seats.map((s) => [s.id, parseWholeStacks(boxes[s.id] ?? "")]),
  );
  const readable = drop.seats.every((s) => parsed[s.id] !== null);
  const whole = Object.fromEntries(drop.seats.map((s) => [s.id, parsed[s.id] ?? 0]));
  const assigned = assignedStacks(whole);
  const adds = readable && assigned === drop.bundles;
  const tallies = adds ? pieceTallies(drop, whole) : null;
  // Cleared boxes are how you decline to answer, so they are not a shortfall to complain about.
  const unanswered = draftUnanswered(drop, boxes);

  return (
    <div className="config-vestige">
      <div className="config-shares">
        {drop.seats.map((seat) => {
          const tally = tallies?.get(holderKey(holderOf(seat))) ?? null;
          return (
            <label className="config-share" key={seat.id}>
              {seat.name}
              <input
                className="split-input"
                value={boxes[seat.id] ?? ""}
                onChange={(e) => onChange({ ...boxes, [seat.id]: e.target.value })}
                placeholder="0"
                inputMode="numeric"
                aria-label={`Stacks ${seat.name} picked up`}
                disabled={busy}
              />
              <span className="config-share-stacks">{tally ? tallyLabel(tally) : ""}</span>
            </label>
          );
        })}
      </div>

      {readable && !adds && !unanswered && (
        <span className="split-error">
          {assigned} of {drop.bundles} stacks placed
        </span>
      )}
      {!readable && <span className="split-error">whole stacks only</span>}
    </div>
  );
}
