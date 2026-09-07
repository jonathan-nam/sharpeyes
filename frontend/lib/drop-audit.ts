// One drop, from the night it fell to the act that closed it.
//
// The Settled tab and the Settlement Ledger both name a drop and both used to open the party it fell
// in, which answers a different question: the party is every drop that boss ever gave you, and what
// the reader clicked was one of them. This is that one.
//
// NOT a second reader. Every figure here comes off the same places the rows that link here read:
// splitOf() for the money, the DropEntry for the coupon gap, and the settlement and debt rows for the
// acts. What this file adds is ORDER, which is the only thing an audit is for.
//
// A coupon night has no sale of its own and never will. Pieces sell in lots that name no boss, and
// the machinery that used to apportion a lot back over the nights it covered was deleted on purpose
// (see the header of lib/piece-ledger.ts). So a coupon night's history ends at the settlement, and
// this file states no price for one.

import { splitOf } from "./loot";
import { holderKey } from "./vestige-ledger";
import { couponSide, dropStatusLabel } from "./drop-log";
import type { DropEntry } from "./drop-log";
import type { Currency } from "./money";
import type { Boss } from "@/types/boss";
import type { WorldType } from "./world";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party } from "@/types/party";
import type { SettlementDebt, VestigeSettlement } from "@/types/vestige";

/**
 * One thing that happened to the drop.
 *
 * `at` is null where the act genuinely has no date. Nothing here guesses one: a drop taken rather
 * than sold records who took it and nothing else, and a share still unpaid has not happened yet.
 */
export type AuditEvent =
  | {
      kind: "DROPPED";
      key: string;
      at: string;
      /** Already labelled with the party's difficulty. Null when the boss is not in the catalog. */
      boss: string | null;
      /** Who you ran it with that week. Empty on a solo. */
      ranWith: string[];
    }
  | {
      /** Whose hands the coupons ended the night in, where they did not divide. */
      kind: "HELD";
      key: string;
      at: null;
      other: string;
      pieces: number;
      /** True when the pieces are yours and they are holding them. */
      yours: boolean;
    }
  | {
      kind: "SOLD";
      key: string;
      at: string;
      amount: number;
      /** LISTED, RECEIVED or BOUGHT. What `amount` MEANS, so it is never dropped. */
      basis: string | null;
      seller: string | null;
      /** What there was to split, fee already off. Null when the split names a seat that has left. */
      pooled: number | null;
      yourTake: number | null;
      /** The unit all three figures are in. Cents when USD. See lib/money.ts. */
      currency: Currency;
    }
  | { kind: "TAKEN"; key: string; at: null; by: string }
  | {
      /** A share that was marked paid. `at` is null on a row paid before the date was recorded. */
      kind: "PAID";
      key: string;
      at: string | null;
      who: string;
      amount: number;
      /** The unit `amount` is in, off the sale it is a share of. */
      currency: Currency;
    }
  | {
      /** A share discharged against a debt of yours rather than sent. See V58. */
      kind: "OFFSET";
      key: string;
      at: string;
      who: string;
      /** Null when the split names a seat that has left, so no share can be read. */
      amount: number | null;
      /** The unit `amount` is in, off the sale it is a share of. */
      currency: Currency;
    }
  | {
      /** The act that closed a coupon night's books. See V52. */
      kind: "SETTLED";
      key: string;
      at: string;
      who: string;
      pieces: number;
      writtenOff: number;
    }
  | {
      kind: "OWED";
      key: string;
      at: null;
      who: string;
      amount: number;
      /** The unit `amount` is in, off the sale it is a share of. */
      currency: Currency;
    };

export type DropAudit = {
  lootId: string;
  partyId: string;
  /** Where that config's page is, for the one link off this page. See lib/party-path.ts. */
  partySlug: string;
  /**
   * The config the drop fell on is off every list, so there is nowhere to send a reader.
   *
   * A retired config keeps its pool (deleting it would take a settled split with it) and Party View
   * does not list it, so a link there opens a party the account no longer has.
   */
  partyRetired: boolean;
  name: string;
  iconUrl: string | null;
  /** What FELL, as the pool files it. Your part of it is `yours`. */
  quantity: number;
  /**
   * How many of it are yours, which on a divided night is not what fell.
   *
   * The Drop Log row counts a coupon night as x30 and the pool row as x60, deliberately, and this
   * page was reachable from the first while showing only the second. See DropEntry.yours.
   */
  yours: number;
  /** Already labelled with the party's difficulty. Null when the boss is not in the catalog. */
  boss: string | null;
  /** Raw, not a label: the badge wants a class off it as well as words. See statusLabel. */
  status: string;
  /**
   * What the badge SAYS, which is the Drop Ledger's own label so the two screens cannot disagree.
   *
   * Off the raw status this page read "In the pool" on every coupon night, and a coupon night never
   * sells, so it never left. See dropStatusLabel.
   */
  stage: string;
  /** The reset week it fell in, as that week's Thursday. The server's reckoning. */
  weekStart: string;
  /** Whose config it fell on. Null when that character has no seat left to name it. */
  character: string | null;
  /** Why a drop can be taken rather than sold: Heroic worlds do not trade. See lib/world.ts. */
  worldType: WorldType;
  events: AuditEvent[];
};

/** A settlement's write-off, spread over the drops it closed. The same share settled-log gives. */
function shareOfWriteOff(unpaid: number, drops: number, index: number): number {
  if (drops < 1 || unpaid < 1) return 0;
  const each = Math.floor(unpaid / drops);
  return index === 0 ? each + (unpaid - each * drops) : each;
}

/** Oldest first, undated last. An act with no date is one nobody can place, not one from day zero. */
function inOrder(events: AuditEvent[]): AuditEvent[] {
  return [...events].sort((a, b) => {
    if (a.at === null && b.at === null) return 0;
    if (a.at === null) return 1;
    if (b.at === null) return -1;
    return a.at.localeCompare(b.at) || a.key.localeCompare(b.key);
  });
}

/**
 * Everything that happened to one drop, in the order it happened.
 *
 * Null when the pool no longer has the drop, or when the log has no entry for it. Refused rather
 * than half-answered: a page that draws a heading and no history reads as a drop with no history.
 *
 * The stages are fixed and the acts inside the last one are sorted by date. A drop falls, its
 * coupons land somewhere, it sells or is taken, and then it is paid off; that is one direction, and
 * sorting the whole list by date would put an undated act wherever the sort felt like.
 */
export function buildDropAudit(
  lootId: string,
  entries: DropEntry[],
  pools: PartyLootPool[],
  parties: Party[],
  bossByKey: Map<string, Boss>,
  settlements: VestigeSettlement[],
  debts: SettlementDebt[],
  /** What to call a holder, keyed the way holderKey() spells them. */
  names: Map<string, string>,
  /** Boss name with its difficulty, passed in so this file does not import the label rules. */
  label: (name: string, difficulty: string | null) => string,
): DropAudit | null {
  const entry = entries.find((e) => e.lootId === lootId);
  if (!entry) return null;

  const party = parties.find((p) => p.id === entry.partyId);
  const loot = findLoot(pools, entry.partyId, lootId);
  if (!party || !loot) return null;

  const boss = bossByKey.get(entry.bossKey ?? "");
  const bossName = boss ? label(boss.name, party.difficulty) : null;

  const events: AuditEvent[] = [
    {
      kind: "DROPPED",
      key: "dropped",
      at: entry.droppedOn,
      boss: bossName,
      ranWith: entry.ranWith,
    },
  ];

  // Which hands the coupons are in. Off the log's own reading of the arrangement, never re-divided
  // here: `owedToYou` is the GAP between a share and what was picked up, and the whole share is a
  // different number. See DropEntry.
  //
  // Through couponSide, so BOTH directions get the row. Read off `owedBy` alone, the night you loot
  // the lot had no line here at all, which is the night this page is most often opened on.
  const side = couponSide(entry);
  if (side !== null && (entry.owedToYou > 0 || entry.owedByYou > 0)) {
    events.push({
      kind: "HELD",
      key: "held",
      at: null,
      other: side.name,
      pieces: entry.owedToYou > 0 ? entry.owedToYou : entry.owedByYou,
      // Whose they are, which is the opposite of who is holding them. See AuditEvent.
      yours: !side.youHold,
    });
  }

  if (entry.takenByName !== null) {
    events.push({ kind: "TAKEN", key: "taken", at: null, by: entry.takenByName });
  } else if (entry.soldAt !== null && entry.saleAmount !== null) {
    events.push({
      kind: "SOLD",
      key: "sold",
      at: entry.soldAt,
      amount: entry.saleAmount,
      basis: entry.amountBasis,
      seller: entry.sellerName,
      pooled: entry.pooled,
      yourTake: entry.yourTake,
      currency: entry.currency,
    });
  }

  const acts: AuditEvent[] = [];
  const split = splitOf(loot, party.seats);
  const payFor = new Map((split?.shares ?? []).map((s) => [s.memberId, s]));

  // A share an offset covered is not ALSO a share somebody sent mesos for. The act marks the payout
  // paid, so reading the payout row as well would say the same money twice, once as sent and once as
  // taken off a debt. The offset is what happened; the paid flag is its bookkeeping. See V58.
  const discharged = new Set<string>();
  for (const debt of debts) {
    for (const payout of debt.payouts) {
      if (payout.lootId !== lootId) continue;
      discharged.add(payout.memberId);
      const who = names.get(holderKey(debt.holder)) ?? holderKey(debt.holder);
      acts.push({
        kind: "OFFSET",
        key: `offset:${debt.id}:${payout.memberId}`,
        at: debt.incurredAt,
        who,
        amount: payFor.get(payout.memberId)?.pay ?? null,
        currency: entry.currency,
      });
    }
  }

  for (const payout of loot.payouts) {
    if (discharged.has(payout.memberId)) continue;
    const share = payFor.get(payout.memberId);
    // A share with no figure behind it is left off rather than shown at zero. splitOf refuses the
    // whole drop when one seat has left, and "paid 0" is the confident wrong number.
    if (!share) continue;
    acts.push(
      payout.paid
        ? {
            kind: "PAID",
            key: `paid:${payout.memberId}`,
            at: payout.paidAt,
            who: share.name,
            amount: share.pay,
            currency: entry.currency,
          }
        : {
            kind: "OWED",
            key: `owed:${payout.memberId}`,
            at: null,
            who: share.name,
            amount: share.pay,
            currency: entry.currency,
          },
    );
  }

  for (const act of settlements) {
    if (!act.lootIds.includes(lootId)) continue;
    // Ordered, so which drop carries the odd meso of a write-off is the same here as on the Settled
    // tab. Both spread it the same way over the same sorted list.
    const closed = [...act.lootIds].sort();
    acts.push({
      kind: "SETTLED",
      key: `settled:${act.id}`,
      at: act.settledAt,
      who: names.get(holderKey(act.holder)) ?? holderKey(act.holder),
      pieces: entry.owedToYou > 0 ? entry.owedToYou : entry.owedByYou,
      writtenOff: shareOfWriteOff(act.unpaid, closed.length, closed.indexOf(lootId)),
    });
  }

  return {
    lootId,
    partyId: entry.partyId,
    partySlug: party.slug,
    partyRetired: party.retired,
    name: entry.name,
    iconUrl: entry.iconUrl,
    quantity: entry.quantity,
    yours: entry.yours,
    boss: bossName,
    status: entry.status,
    stage: dropStatusLabel(entry),
    weekStart: entry.weekStart,
    // The seat the config is built on, which is the one seat of yours that is always there. Read off
    // `seats` rather than `members`: a week you sat out still has the character whose config it is.
    character: party.seats.find((seat) => seat.characterId === party.characterId)?.name ?? null,
    worldType: party.worldType,
    events: [...events, ...inOrder(acts)],
  };
}

function findLoot(pools: PartyLootPool[], partyId: string, lootId: string): Loot | null {
  const pool = pools.find((p) => p.partyId === partyId);
  return pool?.loot.find((row) => row.id === lootId) ?? null;
}
