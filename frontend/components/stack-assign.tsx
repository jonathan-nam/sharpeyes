"use client";

import { useSaveSlot } from "@/components/save-group";
import { useState } from "react";
import {
  type ShareConfig,
  parseStacks,
  piecesPerWeek,
  sharesFromStacks,
  stacksLabel,
  stacksPerWeek,
} from "@/lib/vestige-stacks";

// How this party splits the boss's coupons: one box per member, holding stacks A WEEK.
//
// A half is ordinary. 1.5 a week is three stacks over two, which is what the odd stack rotating
// already does; this is that arrangement said as one figure rather than as an alternation nobody
// can read off a share. What is saved is the party's share ratio, so 1.5 and 1.5 is 1:1.
//
// The same grid the party config uses for shares, because it is the same fact said in the unit
// people actually use: the config asks for a ratio, and nobody says "two to one", they say "he
// takes four stacks and I take two".
//
// Read-only until the panel's own Edit, which is the one that already swaps the roster for its
// inputs: one press opens everything on the row that can be answered, and one Save writes it (see
// SaveGroup). A screen that only STATES the split passes no onSave, and read-only is all it can
// ever be.

export function StackAssign({
  config,
  editing,
  busy,
  onSave,
}: {
  config: ShareConfig;
  editing: boolean;
  busy: boolean;
  /** The new ratio, by seat id. The page turns it into the party's own save. Absent is read-only. */
  onSave?: (shares: Map<string, number>) => Promise<void>;
}) {
  if (!editing || !onSave) return <ShareSummary config={config} />;
  return <ShareBoxes config={config} busy={busy} onSave={onSave} />;
}

/** What the split says when nobody is editing it: what falls, and what each of them takes of it. */
function ShareSummary({ config }: { config: ShareConfig }) {
  const stacks = stacksPerWeek(config);
  const pieces = piecesPerWeek(config);
  return (
    <div className="config-vestige">
      <span className="config-share-drop">
        {config.quantity} in {config.bundles} stacks of {config.size}
      </span>
      <div className="config-shares">
        {config.seats.map((seat) => (
          <span className="config-share" key={seat.id}>
            {seat.name}
            {/* Both, because neither follows from the other without the stack size in your head. */}
            <span className="config-share-stacks">
              {stacksLabel(stacks.get(seat.id) ?? 0)} a week, {pieces.get(seat.id) ?? 0} coupons
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function ShareBoxes({
  config,
  busy,
  onSave,
}: {
  config: ShareConfig;
  busy: boolean;
  onSave: (shares: Map<string, number>) => Promise<void>;
}) {
  // Opened on what the party is already split by. Text rather than numbers, so a half-typed box is
  // refused at Save instead of snapping to something nobody meant.
  const [boxes, setBoxes] = useState<Record<string, string>>(() =>
    Object.fromEntries([...stacksPerWeek(config)].map(([id, stacks]) => [id, stacksLabel(stacks)])),
  );
  const parsed = new Map(config.seats.map((seat) => [seat.id, parseStacks(boxes[seat.id] ?? "")]));
  const readable = [...parsed.values()].every((value) => value !== null);
  const typed = new Map([...parsed].map(([id, value]) => [id, value ?? 0]));
  const placed = [...typed.values()].reduce((sum, n) => sum + n, 0);
  // The week has to be shared out whole. A ratio that comes to less than what falls is not a split
  // of it, and the difference would quietly become somebody's.
  const adds = readable && placed === config.bundles;
  const pieces = adds ? piecesFor(config, typed) : null;
  // Against the labels the boxes open on, so a third of a stack that cannot be typed is not a change.
  const onFile = stacksPerWeek(config);
  const changed = config.seats.some(
    (seat) => parsed.get(seat.id) !== parseStacks(stacksLabel(onFile.get(seat.id) ?? 0)),
  );
  const shares = adds ? sharesFromStacks(typed) : null;

  const saving = useSaveSlot({
    changed,
    ready: shares !== null,
    save: () => onSave(shares!),
  });
  const held = busy || saving;

  return (
    <div className="config-vestige">
      <span className="config-share-drop">
        {config.quantity} in {config.bundles} stacks of {config.size}
      </span>

      <div className="config-shares">
        {config.seats.map((seat) => (
          <label className="config-share" key={seat.id}>
            {seat.name}
            <input
              className="split-input"
              value={boxes[seat.id] ?? ""}
              onChange={(e) => setBoxes({ ...boxes, [seat.id]: e.target.value })}
              placeholder="0"
              inputMode="decimal"
              aria-label={`Stacks a week ${seat.name} takes`}
              disabled={held}
            />
            <span className="config-share-stacks">
              {pieces ? `${pieces.get(seat.id) ?? 0} coupons` : ""}
            </span>
          </label>
        ))}
      </div>

      {/* Only the arithmetic, and only while it is wrong: what is left to place is the one thing
          the boxes cannot show, and it is what Save is waiting for. */}
      {readable && !adds && (
        <span className="split-error">
          {stacksLabel(placed)} of {config.bundles} stacks split
        </span>
      )}
      {!readable && <span className="split-error">whole or half stacks</span>}
    </div>
  );
}

/** What the typed stacks come to in coupons, straight off the stack size. */
function piecesFor(config: ShareConfig, stacks: Map<string, number>): Map<string, number> {
  return new Map([...stacks].map(([id, value]) => [id, value * config.size]));
}
