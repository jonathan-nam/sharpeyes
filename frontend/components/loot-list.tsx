"use client";

import Link from "next/link";

import { LootRow } from "@/components/loot-row";
import { LootRotation } from "@/components/loot-rotation";
import { StackAssign } from "@/components/stack-assign";
import { StackPickup } from "@/components/stack-pickup";
import { isPieceDrop, type PieceStatus } from "@/lib/drop-log";
import { pickupStated, type StackDrop } from "@/lib/vestige-pickup";
import type { Rotation } from "@/lib/loot-rotation";
import type { ShareConfig } from "@/lib/vestige-stacks";
import type { Loot, SellLootBody } from "@/types/loot";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { Party } from "@/types/party";

/** How this party splits the coupons, and the write that changes it. */
export type StackAssignment = {
  /** The stacking drop this is all about, so a caller can tell when its own form is drawing it. */
  dropKey: string;
  /** What the boss drops and who is splitting it. Off the catalog, not off a logged drop. */
  config: ShareConfig;
  /**
   * Heads the split, which is the standing deal rather than any one night.
   *
   * The block's only heading. It used to sit under a second one naming the coupon and the fact that
   * this is a config, with the week's own stack of coupons inside the same frame: a drop that had
   * fallen, filed under a heading about settings. What fell belongs to the drops above.
   */
  entitledTitle: string;
  /**
   * Each holder's coupon position, for a night that has NO ROW yet.
   *
   * Only the Add Drop form's draft wants it: every night that exists carries its own, so the two
   * kinds of night in one panel cannot be opened against each other's. See StackDrop.behind.
   */
  behind: Map<string, number>;
  /** The new ratio, by seat id. Absent where the screen states the split rather than answering it. */
  onSave?: (shares: Map<string, number>) => Promise<void>;
  /**
   * What actually got picked up, per night, for the drops that can still be said.
   *
   * A different fact from the config above it: that is the deal, this is what happened, and the debt
   * is the gap. Keyed by loot id, because it belongs to one drop and the config belongs to the party.
   */
  pickup: NightPickup;
};

/** Who picked up which stacks, per night, and the write that records it. */
export type NightPickup = {
  /** Heads the boxes under a night's row. What happened, against the deal above it. */
  title: string;
  drops: StackDrop[];
  /**
   * Nights whose books are CLOSED, by loot id. Stated like any other, never editable.
   *
   * assignableDrops already drops a night that sold or was taken, but whether a debt is finished
   * is a decision it cannot reach: that lives in the settlements. A settled night rewritten here
   * would move a figure somebody has already been paid against, so it is history and reads as it.
   */
  locked?: Set<string>;
  /** Absent where the screen states the night rather than answering it. */
  onSave?: (lootId: string, bundles: Record<string, number>) => Promise<void>;
};

// The rows of a pool, split into what sells and what settles in coupons. Carried by the party's own
// page and by a row on Party View, the same component in both so the two cannot disagree about
// which side of the split a drop is on, or about what may be done to it.

// A coupon row's status is PASSED IN, never read off the row: a piece drop is PENDING for ever,
// because it settles through the tranche ledger and never through a sale of its own, so the raw
// status said "In the pool" on every vestige stack a party had ever dropped. The answer depends on
// the settlements, which no component here has any business fetching. See pieceStatusByParty.

export function LootList({
  party,
  loot,
  dropTables,
  bossByKey,
  pieceStatus,
  stacks,
  rotation,
  piecePickup,
  splitElsewhere,
  couponRemovable,
  editing,
  readOnly = false,
  panel,
  busy,
  isSaving,
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
  pieceStatus?: PieceStatus;
  /**
   * Who picked up which stacks, for the coupon rows that can still be handed out.
   *
   * Absent on a past week, whose rows are history. The party's own page carries it WITHOUT the
   * onSaves, which states the night and the deal without offering to change either: a debt nobody
   * can explain is the one somebody argues with, and "40 took, 60 due" is the whole explanation.
   */
  stacks?: StackAssignment;
  /**
   * Whose turn it is to bend down, for a piece that cannot change hands.
   *
   * Absent where there is nothing to rotate, which is most of the catalog: see rotatingDrops. It is
   * NOT the coupon split above. That one is a deal about how to divide a pile that can be handed
   * over afterwards; this is a schedule, because these cannot.
   */
  rotation?: Rotation | null;
  /**
   * Who picked up which stacks of the rotating piece, drawn under the night it is about.
   *
   * Its own prop rather than a second drop inside `stacks`, because a piece rotates on modes that
   * drop no coupon at all: Chaos Kalos, Normal Kaling and half the others. Hung off the coupon's
   * block it would be unanswerable on every one of them, and an unanswerable night is what leaves
   * the rotation with nothing to turn on.
   */
  piecePickup?: NightPickup;
  /**
   * The standing split is being drawn somewhere else on this screen, so it is not drawn here.
   *
   * True while the Add Drop form has the stacking drop picked and is showing an editable copy. Two
   * of them, each with a Save, is two answers to one question, and the one being typed into is the
   * one to keep. The night's PICKUP is unaffected: that is about a row that already exists.
   */
  splitElsewhere?: boolean;
  /** Whether a coupon row offers Remove. See LootRow's couponRemovable. */
  couponRemovable?: boolean;
  /**
   * Whether the panel is in edit mode, which is the only state the stack boxes take typing in.
   *
   * Owned by the card and not by the page: it is the same Edit that swaps the roster strip for its
   * inputs, so one press opens everything on the row that can be answered.
   */
  editing?: boolean;
  /** Somebody else's pool: every row reads, none of them offer a write. See LootRow.readOnly. */
  readOnly?: boolean;
  /**
   * These rows are a Party View row's panel rather than a page, so the two kinds are named.
   *
   * A panel's neighbours are headed, and its own heading is the boss. A page's pool already has
   * "Loot pool" over it, so a "Drops" under that is the same word twice. It rode on `stacks` until
   * the party's own page carried those too.
   */
  panel?: boolean;
  /** Whether the ROW's own write is in flight. The config save is the party's, not one drop's. */
  busy?: boolean;
  /** Whether THIS drop's write is in flight, by its id. */
  isSaving: (lootId: string) => boolean;
  onSell: (lootId: string, body: SellLootBody) => void;
  onUnsell: (lootId: string) => void;
  onSetTaken: (lootId: string, memberId: string | null) => void;
  onSetPaid: (lootId: string, memberId: string, paid: boolean) => void;
  onDelete: (lootId: string) => void;
}) {
  // The same test the Drop Log divides on, so what the two screens call a coupon cannot drift.
  const coupons = loot.filter((item) => isPieceDrop(item, party, dropTables));
  const sellable = loot.filter((item) => !isPieceDrop(item, party, dropTables));
  // Headed only when both kinds are present. A pool of one kind is just the pool.
  const headed = sellable.length > 0 && coupons.length > 0;
  // The coupons take NO heading of their own. "Drops" above already covers them, which is the
  // reading that was asked for ("make it a bit more obvious that the Vestiges are part of the drops
  // for the week"): a second word under the first said they were a separate kind of thing, when
  // what they are is the night's biggest drop. What keeps them from reading as configuration is
  // that the deal is a block of its own, not that they were labelled.
  //
  // "Drops" still where the pool is a PANEL holding only coupons, whose neighbours are headed too.
  const couponTitle = !headed && panel ? "Drops" : null;
  // Whichever kind is on its own carries the same word, so a week of one hammer and a week of one
  // stack of coupons are headed alike.
  const sellableTitle = headed || panel ? "Drops" : null;

  return (
    <>
      {/* Sellable drops first, then the coupons, because they are settled in different places and
          a hammer was easy to lose among them. One sells here for a pot that divides as money; a
          stack of coupons divides by COUNT and is priced on the Drop Log, in tranches. */}
      <LootGroup
        rows={sellable}
        title={sellableTitle}
        party={party}
        bossByKey={bossByKey}
        isSaving={isSaving}
        readOnly={readOnly}
        onSell={onSell}
        onUnsell={onUnsell}
        onSetTaken={onSetTaken}
        onSetPaid={onSetPaid}
        onDelete={onDelete}
      />
      <LootGroup
        rows={coupons}
        title={couponTitle}
        party={party}
        bossByKey={bossByKey}
        statusOf={pieceStatus}
        pieces
        couponRemovable={couponRemovable}
        stacks={stacks}
        piecePickup={piecePickup}
        splitElsewhere={splitElsewhere}
        editing={editing}
        busy={busy}
        isSaving={isSaving}
        readOnly={readOnly}
        onSell={onSell}
        onUnsell={onUnsell}
        onSetTaken={onSetTaken}
        onSetPaid={onSetPaid}
        onDelete={onDelete}
      />
      {/* The standing deal, when there is no drop for it to hang under. What the boss gives is a
          fact about the boss, so the split can be agreed in a week nobody has run it yet, and a
          week that HAS one carries this under the row instead: see LootGroup. */}
      {stacks && !splitElsewhere && coupons.length === 0 && (
        <div className="loot-config-card">
          <h3 className="loot-group-title is-config">{stacks.entitledTitle}</h3>
          <StackAssign
            config={stacks.config}
            editing={editing ?? false}
            busy={busy ?? false}
            onSave={stacks.onSave}
          />
        </div>
      )}
      {/* Whose turn it is, which is a fact about the boss and the weeks already answered for, so it
          stands whether or not this week's piece has fallen yet. Unconditional on the rows above it
          for that reason, unlike the split, which hangs under its own night when there is one.
          It frames itself, because the DROP heads it rather than a title of ours. */}
      {rotation && (
        <LootRotation
          rotation={rotation}
          // Off the same nights the boxes above are drawn from, so the block and the row it sits
          // under cannot disagree about whether the week has been answered. A week with no piece
          // logged at all is unanswered, which is what the empty list says.
          answered={
            (piecePickup?.drops.length ?? 0) > 0 &&
            (piecePickup?.drops.every((d) => d.recorded) ?? false)
          }
        />
      )}
    </>
  );
}

/**
 * The night this row is, and which block carries it.
 *
 * The two are returned together because they have to stay paired: the coupon's list and the piece's
 * carry their own title, their own write and their own balance, and a night opened against the other
 * one's would suggest an arrangement off a debt it has nothing to do with.
 */
function nightIn(
  lootId: string,
  pickup: NightPickup | undefined,
): { night: StackDrop; pickup: NightPickup } | null {
  const night = pickup?.drops.find((d) => d.lootId === lootId);
  return night && pickup ? { night, pickup } : null;
}

/**
 * One half of a split pool, or the whole of an unsplit one.
 *
 * At module level and not nested in LootList, which would be a new component type on every render:
 * React would unmount the rows and take a half-typed sale with them.
 */
function LootGroup({
  rows,
  title,
  party,
  bossByKey,
  statusOf,
  stacks,
  piecePickup,
  splitElsewhere,
  couponRemovable,
  editing,
  readOnly = false,
  busy,
  pieces,
  isSaving,
  onSell,
  onUnsell,
  onSetTaken,
  onSetPaid,
  onDelete,
}: {
  rows: Loot[];
  /** Null when the pool holds one kind, which needs no heading to tell it from the other. */
  title: string | null;
  party: Party;
  bossByKey: Map<string, Boss>;
  /** What a coupon row says it is, and how much of it is yours. Absent for the sellable group. */
  statusOf?: PieceStatus;
  /** Who picked up which stacks, drawn under the row it is about. */
  stacks?: StackAssignment;
  /** The same, for the piece that rotates. See LootList. */
  piecePickup?: NightPickup;
  /** The split is being drawn by the Add Drop form instead. See LootList. */
  splitElsewhere?: boolean;
  /** Whether a coupon row offers Remove. See LootRow's couponRemovable. */
  couponRemovable?: boolean;
  /** Whether those boxes take typing. See LootList. */
  editing?: boolean;
  readOnly?: boolean;
  /** Whether the row's own write is in flight. */
  busy?: boolean;
  /** These rows are stacks of pieces, which do not sell here. See LootRow's `pieces`. */
  pieces?: boolean;
  isSaving: (lootId: string) => boolean;
  onSell: (lootId: string, body: SellLootBody) => void;
  onUnsell: (lootId: string) => void;
  onSetTaken: (lootId: string, memberId: string | null) => void;
  onSetPaid: (lootId: string, memberId: string, paid: boolean) => void;
  onDelete: (lootId: string) => void;
}) {
  // A list of what fell, so an empty one draws nothing. The split it is read against is the party's
  // and stands in a week nobody ran, which is why that block is LootList's and not this group's.
  if (rows.length === 0) return null;
  return (
    <>
      {title && (
        <h3 className="loot-group-title">
          {/* The coupon heading links to where they are priced, rather than a sentence saying so. The
              row has no sale of its own, and one word already on screen can carry that. Not in a
              panel, where the row underneath is one press from the same page. */}
          {pieces && !stacks ? <Link href="/bosses/drops">{title}</Link> : title}
        </h3>
      )}
      <div className="loot-list">
        {rows.map((item) => {
          // The night this row is and the block it belongs to, when it can still be said who took
          // what. A row is one drop, so at most one of the two lists holds it.
          const found = nightIn(item.id, stacks?.pickup) ?? nightIn(item.id, piecePickup);
          const night = found?.night;
          // Boxes only where there is a write to take them and the night is not history. A settled
          // night is history whatever the pool is doing: see NightPickup.locked.
          const answerable = Boolean(
            found &&
            (editing ?? false) &&
            found.pickup.onSave &&
            !found.pickup.locked?.has(item.id),
          );
          return (
            <LootRow
              key={item.id}
              loot={item}
              party={party}
              boss={item.bossKey ? (bossByKey.get(item.bossKey) ?? null) : null}
              status={statusOf?.get(item.id)?.status ?? null}
              yours={statusOf?.get(item.id)?.yours ?? null}
              pieces={pieces}
              couponRemovable={couponRemovable}
              readOnly={readOnly}
              busy={isSaving(item.id)}
              onSell={(body) => onSell(item.id, body)}
              onUnsell={() => onUnsell(item.id)}
              onSetTaken={(memberId) => onSetTaken(item.id, memberId)}
              onSetPaid={(memberId, paid) => onSetPaid(item.id, memberId, paid)}
              onDelete={() => onDelete(item.id)}
            >
              {night && found && (answerable || pickupStated(night)) && (
                <>
                  {/* Named, because it is a different fact from the row it is in and from the deal
                      below: this is what the night actually went like. */}
                  <h4 className="loot-group-title is-config">{found.pickup.title}</h4>
                  <div className="config-vestige">
                    <StackPickup
                      drop={night}
                      party={party}
                      editing={answerable}
                      // The panel hands down its row's flag. A pool that is the page has one write
                      // per drop instead, so the night being saved is the night that dims.
                      busy={busy ?? isSaving(item.id)}
                      onSave={found.pickup.onSave}
                    />
                  </div>
                </>
              )}
              {/* The deal this night is read against, INSIDE the drop it is about, which is what a
                  listing of one coupon stack is: what fell, who picked it up, and what each was
                  entitled to. Both blocks used to follow the row as siblings, so the row's frame
                  closed above them and they read as two loose things in the panel.

                  On the LAST row only. The split is the PARTY's, so a week that dropped twice would
                  otherwise state the same deal in each of them. */}
              {stacks && !splitElsewhere && item.id === rows[rows.length - 1]?.id && (
                <>
                  <h4 className="loot-group-title is-config">{stacks.entitledTitle}</h4>
                  <StackAssign
                    config={stacks.config}
                    editing={editing ?? false}
                    busy={busy ?? false}
                    onSave={stacks.onSave}
                  />
                </>
              )}
            </LootRow>
          );
        })}
      </div>
    </>
  );
}
