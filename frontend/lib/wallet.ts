// What every pool adds up to: who you still owe, and who still owes you.
//
// NOT a second splitter. Every meso below is splitOf()'s, which is splitDrop()'s. This file only
// decides which SIDE of an unpaid share you are on, and adds up the ones that are yours. If a
// number here disagrees with the one on a drop's own row, this file is wrong, because that row is
// reading the same function.
//
// One unpaid share is one transfer that has not happened. A share is between two SEATS; the wallet
// is between two PEOPLE, so shares are folded together by whoever owns the seat on the other side.
// That fold is the whole reason the wallet is worth having: CreedBratton and CreedBratton2 are one
// debt to Chris, and settling it is one transfer rather than two.

import { formatMesos } from "./drop-split";
import { splitOf } from "./loot";
import type { Currency } from "./money";
import type { PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

/** A seat is yours when it links to your roster. The config's own character always is. */
function isMine(member: PartyMember): boolean {
  return member.characterId !== null;
}

/** Which way an unpaid share points. */
export type Direction = "owe" | "owed";

/** One unpaid share, kept whole so a total can be traced back to the drops behind it. */
export type WalletLine = {
  partyId: string;
  lootId: string;
  name: string;
  /** The drop's own art, so a list of shares reads like every other list of drops on this account. */
  iconUrl: string | null;
  bossKey: string | null;
  droppedOn: string;
  direction: Direction;
  /** A member bought it off the party rather than selling it, so no sale can be named. */
  bought: boolean;
  /** The seat on your side, and the seat on theirs. Names, because that is what the game knows. */
  mine: string;
  theirs: string;
  /**
   * Their seat's id. (lootId, theirsId) is what makes a line unique: one drop can owe two of the
   * SAME person's characters, and those are two transfers, not one row drawn twice.
   */
  theirsId: string;
  /**
   * The seat the payout row is against, which is the one being PAID: theirs when you owe, yours
   * when they owe you. Not interchangeable with theirsId, and settling by that instead would mark
   * the wrong seat paid on every line you are owed.
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
 * TWO SUMS, NEVER ONE. There is no rate anywhere in this app, so there is no honest way to add
 * $1,000 to 600b, and the sum that looks like an answer would be the wrong number this repo exists
 * to refuse. A screen shows whichever of these is non-zero, or both.
 */
export type Owings = { owe: number; owed: number; net: number };

const noOwings = (): Owings => ({ owe: 0, owed: 0, net: 0 });

// Coupon debt is NOT here, and no longer has a meso figure anywhere. It is a count of pieces:
// coupons are single-trade, so only the holder can sell them and what they fetched is not knowable
// from this side. A count cannot be added to a wallet of mesos, so it is stated in its own unit on
// the Settlement Ledger. See lib/settlement.ts.

export type Counterparty = {
  key: string;
  name: string;
  /**
   * False when no person owns that character yet. Then this row is a CHARACTER, not a person, and
   * the same human may appear twice under two names. Saying so beats quietly showing two debts as
   * if they were owed to two people.
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
   * Sold drops whose split cannot be read at all, because a seat it names is gone. Counted rather
   * than skipped: a wallet that quietly leaves out a debt is the wrong number this repo exists to
   * prevent, and a total with "2 unreadable" beside it is at least honest about being short.
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
      // Not sold: the mesos do not exist yet, so nobody owes them.
      if (loot.soldAt === null) continue;

      // Without the party there are no seats to read a share against, which is the same position
      // splitOf refuses from. Counted for the same reason.
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

        // A person if you have said whose character it is, otherwise the character itself. Two
        // unattributed names stay two rows: merging them would be a guess about who plays what.
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
    // By how much is outstanding either way, not by the net: a pair who owe each other 5b are the
    // relationship to look at first even when it nets to nothing.
    //
    // Mesos first and dollars as the tie-break, rather than one key made of both. Adding the two
    // would be the rate this app refuses to invent, and it would be doing it where nobody could see
    // it: an order is not a figure, so a wrong one is never caught.
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
