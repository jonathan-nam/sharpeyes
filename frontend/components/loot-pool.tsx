"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { DropPicker } from "@/components/drop-picker";
import { LootList, type StackAssignment } from "@/components/loot-list";
import { StackAssign } from "@/components/stack-assign";
import { nightLabel, poolNights, ranAtThisMode } from "@/lib/pool-nights";
import { isDropHistory, type PieceStatus } from "@/lib/drop-log";
import { takenTally } from "@/lib/loot";
import { modeThisWeek } from "@/lib/parties";
import { memberSeats } from "@/lib/parties/member-view";
import { canTrade } from "@/lib/world";
import type { AddLootBody, Loot, SellLootBody } from "@/types/loot";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { Party } from "@/types/party";

// The party's loot pool: log a drop, then take it through sold and paid out. The form is
// DropPicker and the rows are LootList, both shared with the row on Party View.

export function LootPool({
  party,
  loot,
  dropTables,
  bossByKey,
  pieceStatus,
  stacks,
  adding,
  readOnly = false,
  isSaving,
  onAdd,
  onSell,
  onUnsell,
  onSetTaken,
  onSetPaid,
  onDelete,
}: {
  party: Party;
  loot: Loot[];
  dropTables: DropTables;
  bossByKey: Map<string, Boss>;
  /** What a coupon row says it is. See PieceStatus. */
  pieceStatus?: PieceStatus;
  /**
   * What each seat was entitled to out of a night's coupons, and what they picked up.
   *
   * A gap between the two is a debt, and a debt with nothing on screen behind it is one the other
   * side argues with. Each coupon card's Edit Splits corrects its night's pickup, and the standing
   * split with it where the party's onSave arrives.
   */
  stacks?: StackAssignment;
  /** The picker's own add. Not the rows': one drop being logged does not lock the pool. */
  adding: boolean;
  /**
   * A party somebody else keeps the book for. The pool reads the same; what goes is everything
   * that would write into it, except what a member may do as themselves. See memberSeats.
   */
  readOnly?: boolean;
  /** Whether THIS drop's write is in flight, by its id. */
  isSaving: (lootId: string) => boolean;
  onAdd: (body: AddLootBody) => void | Promise<void>;
  onSell: (lootId: string, body: SellLootBody) => void;
  onUnsell: (lootId: string) => void;
  onSetTaken: (lootId: string, memberId: string | null) => void;
  onSetPaid: (lootId: string, memberId: string, paid: boolean) => void;
  onDelete: (lootId: string) => void;
}) {
  /**
   * Whether the nights run under a different arrangement are on screen.
   *
   * Shut by default, which is the whole point: this page is one configuration, and a one-off takes
   * over the row its pair already has, so the pool it inherits can be somebody else's night at
   * another mode. Openable because those rows are still real and still the only place some of them
   * can be acted on: a drop from a hidden night can hold an unpaid share, and a pool row is where
   * it is marked paid.
   */
  const [showingOthers, setShowingOthers] = useState(false);
  // Drops with nothing left to do, behind their own toggle so the pool reads as a worklist.
  const [showingHistory, setShowingHistory] = useState(false);
  const past = loot.filter((row) => isDropHistory(row, pieceStatus));
  const nights = poolNights(
    loot.filter((row) => !isDropHistory(row, pieceStatus)),
    party,
  );
  const here = nights.filter((night) => ranAtThisMode(night, party));
  const others = nights.filter((night) => !ranAtThisMode(night, party));
  const hidden = others.reduce((count, night) => count + night.loot.length, 0);

  return (
    <section className="loot-pool">
      <div className="loot-pool-head">
        <h2 className="loot-pool-title">Loot Pool</h2>
      </div>

      {(!readOnly || memberSeats(party)) && (
        <DropPicker
          bossKey={party.bossKey}
          worldType={party.worldType}
          table={dropTables[party.bossKey]}
          difficulty={modeThisWeek(party)}
          busy={adding}
          onAdd={onAdd}
        />
      )}

      {/* Nothing of THIS config's. A pool holding only other arrangements' nights is not empty, and
          saying it was would be the screen disagreeing with the line under it. */}
      {here.length === 0 && hidden === 0 && past.length === 0 && (
        <p className="finder-empty">Nothing in the pool yet.</p>
      )}

      {/* The running count, in a world where nothing sells. Not shown where drops become mesos:
          there the pot divides and who physically held the item is not what makes it fair.
          A solo pool has one seat, so there is nobody to be even with. */}
      {!canTrade(party.worldType) && !party.solo && loot.length > 0 && (
        <ul className="loot-tally">
          {takenTally(loot, party.seats).map((seat) => (
            <li key={seat.memberId} className={seat.up ? "is-up" : undefined}>
              <span className="loot-tally-name">{seat.name}</span>
              <span className="loot-tally-count">{seat.taken}</span>
            </li>
          ))}
        </ul>
      )}

      {/* THIS config's nights. One of them is just the pool, and heading it would say in a line
          what the page says already; more than one and each carries the night it was run on.

          What is NOT here is a night run at another MODE. Extreme Kalos and Chaos Kalos share a row
          only because a config is one per (character, boss) and a one-off takes over the row its
          pair already has, so this pool held 540 Extreme coupons under a Chaos heading, on a boss
          that drops none at Chaos. See ranAtThisMode. */}
      {here.map((night) => (
        <div className="loot-night" key={night.weekStart}>
          {here.length > 1 && <h3 className="loot-night-title">{nightLabel(night, party)}</h3>}
          <LootList
            party={party}
            loot={night.loot}
            dropTables={dropTables}
            bossByKey={bossByKey}
            pieceStatus={pieceStatus}
            stacks={stacks}
            // The deal is the PARTY's, not a night's, so it is drawn once below rather than restated
            // under every night that happens to hold coupons. Same reason LootGroup draws it on the
            // last row only.
            splitElsewhere
            editSplits
            isSaving={isSaving}
            readOnly={readOnly}
            onSell={onSell}
            onUnsell={onUnsell}
            onSetTaken={onSetTaken}
            onSetPaid={onSetPaid}
            onDelete={onDelete}
          />
        </div>
      ))}

      {stacks && (here.length > 0 || past.length > 0) && (
        <div className="loot-config-card">
          <h3 className="loot-group-title is-config">{stacks.entitledTitle}</h3>
          <StackAssign config={stacks.config} editing={false} busy={false} onSave={stacks.onSave} />
        </div>
      )}

      {/* Said, not silently dropped: a screen may narrow what it draws, and may not lose rows
          without saying so. Openable because some of them can still be acted on and a pool row is
          the only place to do it. */}
      {hidden > 0 && (
        <div className="loot-elsewhere">
          <Button variant="secondary" onClick={() => setShowingOthers((open) => !open)}>
            {showingOthers ? "Hide" : "Other Nights"}
          </Button>
          {showingOthers &&
            others.map((night) => (
              <div className="loot-night" key={night.weekStart}>
                <h3 className="loot-night-title">{nightLabel(night, party)}</h3>
                <LootList
                  party={party}
                  loot={night.loot}
                  dropTables={dropTables}
                  bossByKey={bossByKey}
                  pieceStatus={pieceStatus}
                  stacks={stacks}
                  splitElsewhere
                  editSplits
                  isSaving={isSaving}
                  readOnly={readOnly}
                  onSell={onSell}
                  onUnsell={onUnsell}
                  onSetTaken={onSetTaken}
                  onSetPaid={onSetPaid}
                  onDelete={onDelete}
                />
              </div>
            ))}
        </div>
      )}

      {past.length > 0 && (
        <div className="loot-elsewhere">
          <Button
            variant="secondary"
            aria-expanded={showingHistory}
            onClick={() => setShowingHistory((open) => !open)}
          >
            {showingHistory ? "Hide Drop History" : `Show Drop History (${past.length})`}
          </Button>
          {showingHistory &&
            poolNights(past, party).map((night) => (
              <div className="loot-night" key={night.weekStart}>
                <h3 className="loot-night-title">{nightLabel(night, party)}</h3>
                <LootList
                  party={party}
                  loot={night.loot}
                  dropTables={dropTables}
                  bossByKey={bossByKey}
                  pieceStatus={pieceStatus}
                  stacks={stacks}
                  splitElsewhere
                  editSplits
                  isSaving={isSaving}
                  readOnly={readOnly}
                  onSell={onSell}
                  onUnsell={onUnsell}
                  onSetTaken={onSetTaken}
                  onSetPaid={onSetPaid}
                  onDelete={onDelete}
                />
              </div>
            ))}
        </div>
      )}
    </section>
  );
}
