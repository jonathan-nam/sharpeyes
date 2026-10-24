// What every pool adds up to: who you still owe, and who still owes you.
//
// NOT a second splitter: every figure is splitOf()'s. This file only decides which SIDE of an
// unpaid share you are on and adds up yours.
//
// A share is between two SEATS; the wallet is between two PEOPLE, so shares are folded together by
// whoever owns the seat on the other side.

import { formatMesos } from "./drop-split";
import { splitOf } from "./loot";
import type { Currency } from "./money";
import type { PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

/**
 * A seat is yours when it links to your roster. The config's own character always is.
 *
 * Shared with the Drop Log so the two screens cannot disagree about whose debt a row is.
 */
export function isMine(member: PartyMember): boolean {
  return member.characterId !== null;
}

/** Which way an unpaid share points. */
export type Direction = "owe" | "owed";

/** One unpaid share, kept whole so a total can be traced back to the drops behind it. */
export type WalletLine = {
  partyId: string;
  lootId: string;
  name: string;
  iconUrl: string | null;
  bossKey: string | null;
  droppedOn: string;
  /** The bossing week it FELL in, never the week it sold. The server's Thursday, as on Loot. */
  weekStart: string;
  direction: Direction;
  /** A member bought it off the party rather than selling it, so no sale can be named. */
  bought: boolean;
  /** The seat on your side, and the seat on theirs, by name. */
  mine: string;
  theirs: string;
  /**
   * Their seat's id. (lootId, theirsId) is what makes a line unique: one drop can owe two of the
   * SAME person's characters, and those are two transfers, not one row drawn twice.
   */
  theirsId: string;
  /**
   * The seat being PAID: theirs when you owe, yours when they owe you. Settle by this, not by
   * theirsId, or every line you are owed marks the wrong seat paid.
   */
  payeeId: string;
  /** What has to move: what the sender lists, before the receiver's Auction House fee. */
  pay: number;
  /** What the receiver is left holding, after that fee. Equal to `pay` when there is no fee. */
  nets: number;
  /** The unit both figures are in, off the drop's own sale. Cents when USD. See splitOf. */
  currency: Currency;
};

/**
 * The same pair of totals in each unit a sale can be priced in.
 *
 * TWO SUMS, NEVER ONE. There is no exchange rate in this app, so dollars and mesos are never added.
 */
export type Owings = { owe: number; owed: number; net: number };

const noOwings = (): Owings => ({ owe: 0, owed: 0, net: 0 });

// Coupon debt is NOT here: it is a count of pieces, not mesos. See lib/settlement.ts.

export type Counterparty = {
  key: string;
  name: string;
  /**
   * False when no person owns that character yet. Then this row is a CHARACTER, and the same human
   * may appear twice under two names.
   */
  attributed: boolean;
  owe: number;
  owed: number;
  /** owed - owe. Positive means they owe you. */
  net: number;
  /** The same three figures for shares of a sale made in real money. See Owings. */
  usd: Owings;
  lines: WalletLine[];
};

export type Wallet = {
  /** Biggest outstanding relationship first. */
  counterparties: Counterparty[];
  owe: number;
  owed: number;
  net: number;
  /** The same three figures for shares of a sale made in real money. See Owings. */
  usd: Owings;
  /**
   * Sold drops whose split cannot be read, because a seat it names is gone. Counted rather than
   * skipped, so a short total says it is short.
   */
  unreadable: number;
  /**
   * Unpaid shares between two OTHER people in your party. Counted, not shown: the point is that
   * they are kept OUT of owe/owed, which is what wallet.test.ts asserts against.
   */
  betweenOthers: number;
  /** Unpaid shares between two of your OWN characters. Mesos to move, but nobody to settle with. */
  betweenMine: number;
};

/**
 * The wallet across every party.
 *
 * Only SOLD drops with an unpaid share count. A drop still in the pool is not a debt (nobody has
 * the mesos yet), and a paid share is not one either.
 */
export function buildWallet(parties: Party[], pools: PartyLootPool[]): Wallet {
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const groups = new Map<string, Counterparty>();
  let unreadable = 0;
  let betweenOthers = 0;
  let betweenMine = 0;

  for (const pool of pools) {
    const party = partyById.get(pool.partyId);

    for (const loot of pool.loot) {
      if (loot.soldAt === null) continue;

      // Without the party there are no seats to read a share against.
      const split = party ? splitOf(loot, party.seats) : null;
      if (!party || split === null) {
        unreadable += 1;
        continue;
      }

      const byId = new Map(party.seats.map((m) => [m.id, m]));
      // splitOf already proved both of these resolve, or it would have returned null.
      const seller = byId.get(split.seller.memberId)!;

      for (const share of split.shares) {
        if (share.paid) continue;
        const member = byId.get(share.memberId)!;
        const sellerMine = isMine(seller);
        const memberMine = isMine(member);

        if (sellerMine === memberMine) {
          if (sellerMine) betweenMine += 1;
          else betweenOthers += 1;
          continue;
        }

        const direction: Direction = sellerMine ? "owe" : "owed";
        const theirs = sellerMine ? member : seller;
        const mine = sellerMine ? seller : member;

        // A person if attributed, otherwise the character. Never merge unattributed names.
        const key = theirs.personId
          ? `person:${theirs.personId}`
          : `character:${theirs.name.toLowerCase()}`;
        let group = groups.get(key);
        if (!group) {
          group = {
            key,
            name: theirs.personName ?? theirs.name,
            attributed: theirs.personId !== null,
            owe: 0,
            owed: 0,
            net: 0,
            usd: noOwings(),
            lines: [],
          };
          groups.set(key, group);
        }

        const side = split.currency === "USD" ? group.usd : group;
        side[direction] += share.pay;
        side.net = side.owed - side.owe;
        group.lines.push({
          partyId: pool.partyId,
          lootId: loot.id,
          name: loot.name,
          iconUrl: loot.iconUrl,
          bossKey: loot.bossKey,
          droppedOn: loot.droppedOn,
          weekStart: loot.weekStart,
          direction,
          bought: loot.amountBasis === "BOUGHT",
          mine: mine.name,
          theirs: theirs.name,
          theirsId: theirs.id,
          payeeId: member.id,
          pay: share.pay,
          nets: share.nets,
          currency: split.currency,
        });
      }
    }
  }

  const counterparties = [...groups.values()].sort(
    // By gross outstanding, not net. Mesos first, dollars as the tie-break: never one key made of
    // both, which would need an exchange rate.
    (a, b) =>
      b.owe + b.owed - (a.owe + a.owed) ||
      b.usd.owe + b.usd.owed - (a.usd.owe + a.usd.owed) ||
      a.name.localeCompare(b.name),
  );
  const owe = counterparties.reduce((sum, c) => sum + c.owe, 0);
  const owed = counterparties.reduce((sum, c) => sum + c.owed, 0);
  const usdOwe = counterparties.reduce((sum, c) => sum + c.usd.owe, 0);
  const usdOwed = counterparties.reduce((sum, c) => sum + c.usd.owed, 0);

  return {
    counterparties,
    owe,
    owed,
    net: owed - owe,
    usd: { owe: usdOwe, owed: usdOwed, net: usdOwed - usdOwe },
    unreadable,
    betweenOthers,
    betweenMine,
  };
}
