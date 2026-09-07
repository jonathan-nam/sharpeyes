// Every drop your parties have logged, as a history with money attached.
//
// NOT a second splitter. Every meso here is splitOf()'s, which is splitDrop()'s, exactly as
// lib/wallet.ts is. This file decides which drops belong in the history and which side of each
// sale is yours.
//
// THE TOTAL THAT IS NOT HERE: the sum of the sale amounts as entered. A drop entered as "listed
// for 10b" and one entered as "received 9.5b" are DIFFERENT QUANTITIES, one before the Auction
// House cut and one after. Adding them produces a confident, plausible, wrong number, which is the
// failure this repo exists to prevent. And the gross cannot be recovered from a received figure:
// drop-split.ts refuses to infer it, because that would put a number on screen the tool was told
// rather than shown.
//
// So the total is WHAT THERE WAS TO SPLIT (Split.sellerReceives). That one is defined for all
// three bases: a listed price less the seller's fee, a received figure as entered, or the price a
// party member bought it for, which no fee came off. It is the only cross-basis sum that means one
// thing.

import { formatWeekStart } from "./boss-clears";
import { saleMoney, splitOf, statusLabel } from "./loot";
import type { Currency } from "./money";
import type { CouponsOutstanding } from "./loot";
import { closureKeyOf, couponGapOf, ranSeats, yourShare } from "./vestige-ledger";
import { canTrade, isPerMember } from "./world";
import type { BossDrop, DropTables } from "@/types/drop";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { Party, PartyMember } from "@/types/party";

/** A seat is yours when it links to your roster. Same test the wallet uses. */
function isMine(member: PartyMember): boolean {
  return member.characterId !== null;
}

/** The catalog row behind a logged drop, or null for free text or a boss with no table. */
function catalogDrop(loot: Loot, dropTables: DropTables): BossDrop | null {
  if (loot.dropKey === null) return null;
  return (dropTables[loot.bossKey ?? ""] ?? []).find((d) => d.dropKey === loot.dropKey) ?? null;
}

/**
 * True when this row is a stack of pieces the party divides by COUNT.
 *
 * Read off the catalog's own table for the boss and the mode the drop FELL at, which is the one
 * place that knows: vestige coupons divide, a ring does not, and the row itself cannot tell you
 * which it is holding. A boss with no amount for that mode is not a piece drop, so its count is
 * left exactly as it was entered.
 *
 * The drop's own mode, and the party's only where the row has none. A config's difficulty is
 * editable, so reading it here let an edit re-decide what an already logged stack WAS: moving a
 * Kalos party from Extreme to Chaos, which drops no coupon at all, silently took 540 logged coupons
 * out of the piece maths. The backend keeps the same rule in one place, see fellAt.
 *
 * Read against the party's WORLD as well as the mode, because the count is per world: a boss can
 * drop a divisible pile on Interactive and one item each on Heroic. The world is the character's
 * and does not move.
 *
 * An INSTANCED drop is not one, whatever its count. Every seat received that many in their own
 * inventory, so there is no pot, and dividing it reported a Heroic Kalos Token drop of 2 each as
 * "1 out of 2 yours". In Heroic that is every piece drop there is: pieces are instanced there and
 * only ordinary drops (a grindstone, a ring) still pool.
 *
 * This is DIVISIBILITY only. Whether the pieces can then be moved between members is a second
 * question, and isCouponDrop is the one that asks it.
 */
export function isPieceDrop(loot: Loot, party: Party, dropTables: DropTables): boolean {
  const fellAt = loot.difficulty ?? party.difficulty;
  if (fellAt === null) return false;
  const drop = catalogDrop(loot, dropTables);
  if (isPerMember(drop?.perMember ?? null, party.worldType)) return false;
  return (drop?.pieces?.[party.worldType]?.[fellAt] ?? 0) > 0;
}

/**
 * True when this row is a piece that cannot change hands, whatever its boss or mode.
 *
 * Not the same question as isPieceDrop, which is about DIVIDING and so needs the party's mode. This
 * one is a fact about the item alone, for the screens that want nothing to do with it.
 */
export function isUntradeablePiece(loot: Loot, dropTables: DropTables): boolean {
  return catalogDrop(loot, dropTables)?.untradeable === true;
}

/**
 * True when a piece drop's shortfall is a DEBT: divisible, and made of pieces that can change hands.
 *
 * The two are not the same test, and conflating them is how an Eternal armour piece would end up in
 * the tranche ledger. Both divide by count, so both have an entitled share and a looted share. Only
 * a coupon can be handed over afterwards, which is what makes a gap between the two a debt somebody
 * settles. An untradeable piece leaves a gap nothing can close, so it is owed as a LOOT next week
 * and never as pieces or mesos, and reporting it as a debt would invent a transfer that cannot
 * happen.
 *
 * A Heroic world is the same case reached from the other side: the item is tradeable, the WORLD is
 * not, so nothing there can change hands either. The flag alone let a Heroic night name a creditor
 * for 2 coupons and offer to settle it.
 */
export function isCouponDrop(loot: Loot, party: Party, dropTables: DropTables): boolean {
  return (
    canTrade(party.worldType) &&
    isPieceDrop(loot, party, dropTables) &&
    !catalogDrop(loot, dropTables)?.untradeable
  );
}

export type DropEntry = {
  lootId: string;
  partyId: string;
  /** Whose config it dropped on, so the log can be read one character at a time. */
  characterId: string;
  name: string;
  /** The catalog drop, when it is one. What consolidate() groups on. Null for free text. */
  dropKey: string | null;
  iconUrl: string | null;
  /** What FELL, as V40 files it. Not your share of it, which is `yours`. */
  quantity: number;
  /**
   * This row is a stack of pieces the party divides by COUNT, not a thing that sells as money.
   *
   * It changes what "in the pool" means. A piece drop is settled through the tranche ledger and
   * never through a sale on this row, so its `sold_at` stays null for ever: counting it as pending
   * put every coupon drop the account has ever had into the pool, permanently.
   */
  pieces: boolean;
  /**
   * How many of it are YOURS: your share of a piece drop, or the whole count of anything else.
   *
   * Worked out from the party as it stands, never stored. What the log counts and what a row
   * shows, because "how many did I get" is the question a log of your own drops answers.
   */
  yours: number;
  /**
   * The character holding part of your share. Null when nobody is.
   *
   * WHO, never how much. It survives the night being answered or cancelled, because who bent down
   * does not change: `owedToYou` is the figure, and it can be zero with this still set.
   */
  owedBy: string | null;
  /**
   * The same fact the other way: who YOU are holding coupons for. Null when you are not.
   *
   * Its own field rather than a flag on `owedBy`, so the direction survives the figure being netted
   * to nothing and neither name can be read as the other. Exactly one of the pair is ever set, and
   * `couponSide` is how a screen reads them: taking `owedBy` alone is what left the Drop Ledger
   * silent on the ordinary night, the one where you loot the lot and owe the party their share.
   */
  owedTo: string | null;
  /**
   * How many of your share that character is holding for you. Zero when nobody is.
   *
   * The GAP between your share and what you picked up, not the share itself. A night you looted four
   * stacks of six on owes you nothing even though a partner was there, and reading `yours` as the
   * debt said "90 coupons owed" on an Extreme Kalos whose arrangement had you holding 120 of 180.
   * See couponGapOf.
   *
   * A fact about THIS NIGHT, and nothing else moves it. This file used to spend it down by the
   * coupons you had since sold on that person's behalf, which is an account-wide fact: a boss row's
   * figure then depended on every other party, so Hard Baldrix went silent about a night you looted
   * whole because a tranche crediting Bro had drained the oldest nights, and the row contradicted
   * the "120 took, 60 due" printed directly under it. Selling their share does turn a coupon debt
   * into a meso one (V56), and the SALE LEDGER is the one place that nets it. Nothing else should.
   */
  owedToYou: number;
  /**
   * The same gap the other way: coupons of theirs YOU are holding, to hand over.
   *
   * Only one of the two is ever non-zero. Kept as its own figure rather than a sign, because both
   * are said on screen and a negative number would have to be flipped at every reading of it.
   */
  owedByYou: number;
  /**
   * Its books are closed, so what the pair of names above say is history. See V52.
   *
   * Either name is a fact about the party's ARRANGEMENT, true from the moment the drop is logged and
   * never after: it is `entitled - looted`, which no sale, payment or redemption moves. So without
   * this every coupon row read "Owed" for good and the party badge counted it forever, however
   * completely the ledger had been filled in.
   */
  closed: boolean;
  bossKey: string | null;
  droppedOn: string;
  /** When it was LOGGED, which is what says a sale could have answered it. See spendSales. */
  recordedAt?: string;
  /** The reset week it fell in, as that week's Thursday. The server's reckoning, never redone here. */
  weekStart: string;
  /** ALWAYS / HEROIC when everyone gets their own copy, so the sale is one person's, not a pool's. */
  perMember: string | null;
  status: string;
  /** When it sold, which is the day a money drop was finished. Null while it is still in the pool. */
  soldAt: string | null;
  /** What it sold for, IN `currency`. Cents for a dollar sale, mesos otherwise. See saleMoney. */
  saleAmount: number | null;
  /**
   * The unit `saleAmount`, `pooled` and `yourTake` are all in.
   *
   * On the entry rather than worked out again at each reader, and on EVERY entry rather than only
   * the sold ones, so there is no branch where a figure arrives without one. Mesos where nothing
   * sold, which is the unit an absent figure was always in.
   */
  currency: Currency;
  amountBasis: string | null;
  splitMethod: string | null;
  /** Who took it, where a world cannot sell. Null everywhere else, and on a seat that has left. */
  takenByName: string | null;
  /** Who you ran it with, that week, in characters. Empty on a solo. See ranWith. */
  ranWith: string[];
  /** Who sold it, or who bought it on a BOUGHT basis. Null while it is still in the pool. */
  sellerName: string | null;
  /**
   * What there was to split: what landed in the seller's inventory, fee already off, or the price
   * a member bought it for. Null when unsold, or when the split cannot be read.
   */
  pooled: number | null;
  /** Your side of it: what you kept selling it, plus anything owed to a character of yours. */
  yourTake: number | null;
  /** True when it sold but the split names a seat that has left, so no figure can be shown. */
  unreadable: boolean;
};

/** How the log is broken up. A view choice: the totals above it are the same either way. */
export type Grouping = "month" | "week";

export type DropGroup = {
  /** YYYY-MM for a month, the week's Thursday for a week. Both sort lexically. */
  key: string;
  label: string;
  entries: DropEntry[];
  pooled: number;
  yourTake: number;
  /** The same pair over the group's dollar sales, in cents. Never added to the two above. */
  usd: { pooled: number; yourTake: number };
};

export type DropLogTotals = {
  drops: number;
  sold: number;
  /**
   * Drops somebody took, in a world that cannot sell them.
   *
   * Its own figure rather than part of `sold`, which counted every status that was not PENDING and
   * so would have reported a Heroic account's claimed drops as sales. Nothing sold: there is no
   * buyer, no pot and no meso figure anywhere behind the number.
   */
  taken: number;
  /**
   * Drops with something still to do, which is NOT the same as drops not yet sold.
   *
   * A piece drop you already hold your share of is a record, not work: the coupons are in your
   * inventory, you sell them yourself, and the row will never be marked sold because that is not
   * how pieces settle. Counting those put every coupon drop the account has ever had in the pool,
   * for ever, on parties where the split came out exactly even.
   */
  pending: number;
  /** Across sold drops: what landed in inventories, party-wide. See the header note. */
  pooled: number;
  /** Across sold drops: your side of them. */
  yourTake: number;
  /**
   * The same pair over dollar sales, in cents.
   *
   * A SECOND SUM, never folded into the first. There is no rate in this app, so a total made of
   * both units would be a figure with no meaning stated as confidently as one with a meaning.
   * Every screen drawing these shows whichever is non-zero. See lib/money.ts.
   */
  usd: { pooled: number; yourTake: number };
  /** Sold drops whose split cannot be read. Their money is in neither total above. */
  unreadable: number;
};

export type DropLog = {
  /** Newest first. Grouping is applied at draw time, by groupDrops. */
  entries: DropEntry[];
  totals: DropLogTotals;
};

const MONTHS =
  "January February March April May June July August September October November December".split(
    " ",
  );

/**
 * "2026-07-20" -> "July 2026", without going through Date.
 *
 * new Date("2026-07-20") is UTC midnight, so anyone behind UTC reads the month before on the 1st.
 * Same reasoning as formatDropped in lib/loot.ts.
 */
export function monthLabel(iso: string): string {
  const [year, month] = iso.split("-").map(Number);
  if (!year || !month) return iso;
  return `${MONTHS[month - 1] ?? month} ${year}`;
}

/**
 * "2026-07-16" -> "Week of July 16, 2026".
 *
 * The stem is the week picker's, so a week is worded the same wherever it is named. The year is
 * carried, which the picker does not need: it shows one week, while a log shows every week there
 * has been, and two Julys a year apart would otherwise head two sections identically.
 */
export function weekLabel(weekStart: string): string {
  const year = Number(weekStart.slice(0, 4));
  if (!year) return weekStart;
  return `Week of ${formatWeekStart(weekStart)}, ${year}`;
}

/**
 * Your side of a sale: what you kept if you sold it (or your share of it if you bought it off the
 * party), plus anything owed to a character of yours.
 */
function takeFor(loot: Loot, members: PartyMember[]): number | null {
  const split = splitOf(loot, members);
  if (split === null) return null;

  const byId = new Map(members.map((m) => [m.id, m]));
  const seller = byId.get(split.seller.memberId);
  // Both halves are counted, not one or the other: bringing two of your own characters means you
  // sold it AND are owed a share of it, and taking only the larger would under-count.
  const kept = seller && isMine(seller) ? split.seller.keeps : 0;
  const owed = split.shares
    .filter((share) => {
      const member = byId.get(share.memberId);
      return member ? isMine(member) : false;
    })
    .reduce((sum, share) => sum + share.nets, 0);
  return kept + owed;
}

/**
 * The whole history, newest first. Cut into sections by groupDrops.
 *
 * Every logged drop is here, sold or not: "what have we got off Limbo this year" is as much the
 * question as "what did it make".
 */
/**
 * Who you ran it with, in the characters that ran it.
 *
 * THAT WEEK's roster, off ranSeats: a party's membership is edited, and reading today's would put
 * somebody who joined in December in a row from August. Same rule as the share on the row above it.
 *
 * Your own seats are not in it. The row already names which character of yours the drop is filed
 * under, so listing it again is the one name on the line that says nothing.
 *
 * SEATS, not people: a night is run by characters, and the character is what the party screen, the
 * clear and the arrangement all name. A partner who brought two of them is two names here, which is
 * two characters that were in the party. What one person came to is the ledgers' question.
 */
function ranWith(loot: Loot, party: Party): string[] {
  return ranSeats(loot, party)
    .filter((seat) => !isMine(seat))
    .map((seat) => seat.name);
}

export function buildDropLog(
  parties: Party[],
  pools: PartyLootPool[],
  /** The catalog's drop tables. What says a row is a stack of pieces rather than one item. */
  dropTables: DropTables,
  /**
   * Which (holder, drop) pairs have had their books closed, from closedByHolder(). See V52.
   *
   * Passed in rather than derived, because whether a debt is finished is a DECISION and this file has
   * no way to reach one. Empty is nothing closed, which is every log before V52.
   */
  closed: Set<string> = new Set(),
): DropLog {
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const entries: DropEntry[] = [];
  for (const pool of pools) {
    const party = partyById.get(pool.partyId);
    if (!party) continue;

    for (const loot of pool.loot) {
      const sold = loot.soldAt !== null;
      const split = sold ? splitOf(loot, party.seats) : null;
      const priced = saleMoney(loot);
      const unreadable = sold && split === null;

      // Only a PIECE drop divides by count. Everything else is one thing that sells for one price
      // and divides as money, and a third of an item is not a number to put on a row.
      const pieces = isPieceDrop(loot, party, dropTables);
      // Whose coupons ended the night in the wrong hands, off the night's own arrangement. Only for
      // pieces that can be handed over: an untradeable one leaves a gap nothing can close, so
      // naming a creditor for it would put a transfer on screen that cannot be made.
      const gap = isCouponDrop(loot, party, dropTables) ? couponGapOf(loot, party) : null;

      const entry: DropEntry = {
        lootId: loot.id,
        partyId: pool.partyId,
        characterId: party.characterId,
        name: loot.name,
        dropKey: loot.dropKey,
        iconUrl: loot.iconUrl,
        quantity: loot.quantity,
        pieces,
        // Against the week the drop FELL in, not the week the page asked for. See ranSeats.
        yours: pieces ? yourShare(loot.quantity, ranSeats(loot, party)) : loot.quantity,
        // Named only when somebody ELSE is holding some of it. Your own seat looting the lot is not
        // a debt to you, it is you having it already.
        owedBy: gap !== null && !gap.yours ? gap.by : null,
        // And the creditor when it was your own seat that bent down for more than its share.
        owedTo: gap !== null && gap.yours ? gap.by : null,
        owedToYou: gap !== null && !gap.yours ? gap.pieces : 0,
        owedByYou: gap !== null && gap.yours ? gap.pieces : 0,
        // The holder who owes it is the one whose books close it, so the key is theirs and not the
        // party's. A drop in two piles is closed by whichever of them settled.
        closed: gap !== null && closed.has(closureKeyOf(gap.holder, loot.id)),
        bossKey: loot.bossKey,
        droppedOn: loot.droppedOn,
        recordedAt: loot.recordedAt,
        weekStart: loot.weekStart,
        perMember: loot.perMember,
        status: loot.status,
        soldAt: loot.soldAt,
        saleAmount: priced?.amount ?? null,
        currency: priced?.currency ?? "MESO",
        amountBasis: loot.amountBasis,
        splitMethod: loot.splitMethod,
        // Off `seats` and never `members`: a seat that has since left the party still took the item,
        // and resolving it through this week's roster would lose the name the week after they left.
        takenByName: party.seats.find((s) => s.id === loot.takenByMemberId)?.name ?? null,
        ranWith: ranWith(loot, party),
        sellerName: split?.seller.name ?? null,
        pooled: split?.split.sellerReceives ?? null,
        yourTake: split ? takeFor(loot, party.seats) : null,
        unreadable,
      };
      entries.push(entry);
    }
  }

  // Newest first, and stable on the id so two drops logged the same day keep one order.
  entries.sort(
    (a, b) => b.droppedOn.localeCompare(a.droppedOn) || a.lootId.localeCompare(b.lootId),
  );

  return { entries, totals: totalsOf(entries) };
}

/**
 * Work still to do on a drop.
 *
 * A piece drop is settled through the tranche ledger, never through a sale on its own row, so
 * "not sold" says nothing about it. What is left to do is `owedToYou`, and a party that divided
 * evenly leaves it at zero.
 */
export function isOutstanding(entry: DropEntry): boolean {
  // A piece drop is never counted here, whoever is holding it. It is said in COUPONS instead, by the
  // party row's own figure, and counting it both ways read as two things to do: one coupon drop
  // showed as "1 in the pool · 30 coupons owed", which is one fact twice.
  return entry.status === "PENDING" && !entry.pieces;
}

/**
 * The other side of a coupon night, and which way it runs. Null on a night that came out even.
 *
 * The one place `owedBy` and `owedTo` are read, so a screen cannot answer one direction and go
 * quiet on the other. `youHold` is which inventory the surplus is in, never whose the coupons are:
 * the two read opposite and have been crossed before.
 */
export function couponSide(entry: DropEntry): { name: string; youHold: boolean } | null {
  if (entry.owedTo !== null) return { name: entry.owedTo, youHold: true };
  if (entry.owedBy !== null) return { name: entry.owedBy, youHold: false };
  return null;
}

/**
 * Whose coupons are in the wrong inventory, as a row's meta says it. Null where none are.
 *
 * The count on the row is your SHARE, so neither direction can be read off it: coupons of yours
 * somebody else is holding are not in your inventory, and coupons you are holding for them are not
 * yours. That is why the figure is said here and not in the count. Which way it runs is the badge's.
 *
 * Who bent down stays true after the night is answered, so that name is still said with the figure
 * gone. Not the other way round: "you looted" is not news on a log of your own drops.
 */
export function couponNote(entry: DropEntry): string | null {
  const side = couponSide(entry);
  if (side === null) return null;
  if (!side.youHold) return `${side.name} looted`;
  return entry.owedByYou > 0 ? `${entry.owedByYou} of ${side.name}'s` : null;
}

/**
 * What a row says its state is.
 *
 * "In the pool" off the raw status was wrong for most coupon drops: the row never sells, so it
 * said that for ever on a night where the coupons went straight into the right inventories. Those
 * are yours already, and the row is a record of getting them.
 */
export function dropStatusLabel(entry: DropEntry): string {
  // Neither coupon row belongs in "the pool", which now means drops waiting to be SOLD. One is
  // already in your inventory; the other is in somebody else's, which the row says beside this.
  // Settled first: a closed drop is finished whoever looted it, and "Owed" about one is the party's
  // arrangement being reported as though it were the ledger's answer.
  if (entry.pieces) {
    if (entry.closed) return "Settled";
    // Off the FIGURE, never off who looted it. `owedBy` names whoever bent down, which stays true
    // after a sale has answered the night or the pair has cancelled it; what is still outstanding
    // is the count. Reading the name here said "Owed" on a night nobody has to do anything about.
    if (entry.owedToYou > 0) return "Owed";
    // A night you looted the lot said "Yours" on purpose once, on the grounds that they are in your
    // inventory. So is somebody else's share of them, which is the one thing the row had to say.
    if (entry.owedByYou > 0) return "To hand over";
    return "Yours";
  }
  return statusLabel(entry.status);
}

/** The counts and the money, read off the entries in hand. Never scaled from a wider set. */
function totalsOf(entries: DropEntry[]): DropLogTotals {
  return {
    drops: entries.length,
    // Named states rather than "not PENDING". The catch-all counted TAKEN as a sale the moment
    // that status existed, which is a meso word for a drop no money ever changed hands over.
    sold: entries.filter((e) => e.status === "SOLD" || e.status === "PAID_OUT").length,
    taken: entries.filter((e) => e.status === "TAKEN").length,
    pending: entries.filter(isOutstanding).length,
    pooled: sumIn(entries, "MESO", "pooled"),
    yourTake: sumIn(entries, "MESO", "yourTake"),
    usd: { pooled: sumIn(entries, "USD", "pooled"), yourTake: sumIn(entries, "USD", "yourTake") },
    unreadable: entries.filter((e) => e.unreadable).length,
  };
}

/**
 * Coupons of yours somebody else is holding, out of THIS BOSS's own nights.
 *
 * Off `owedToYou`, which is entitled against looted and nothing else. A boss row asks what came off
 * this boss, so it is answered from this boss's stacks and adds up to the "120 took, 60 due" on the
 * cards beneath it.
 *
 * It used to read the LEDGER pair, which is the same gap spent down by coupons already sold on that
 * person's behalf. Those sales are account-wide, so a row's figure moved for reasons nowhere near
 * it: Hard Baldrix said nothing about a night you looted whole because a tranche crediting Bro had
 * drained the oldest nights, while Hard Kaling still asked for 30, and which of one evening's three
 * nights kept its debt came down to the order their ids happened to sort in.
 *
 * What this deliberately does NOT do is net the money back out. Selling their share turns a coupon
 * debt into a meso one (V56) and the Settlement Ledger is where that lands, so a person's netted
 * position is still one figure in one place. This is the other question, asked per boss.
 *
 * A CLOSED night is still excluded. Closing the books is a decision about that night rather than a
 * sale somewhere else, which is exactly the difference this function now draws.
 *
 * The other direction, coupons YOU are holding for the party, is deliberately not here. A row of a
 * list is not where somebody goes to be told what to hand over, and the drop itself and the Sale
 * Ledger both say it.
 */
export function couponsOutstandingByParty(
  entries: DropEntry[],
  /**
   * The week on screen, so a row answers for the runs under the heading it sits below.
   *
   * Null is the whole pool, which is what a page with no week to name shows. `>=` and not `===`, the
   * same comparison dropsInWeek makes and for the same reason: a row dated after the week is kept
   * rather than hidden, because nothing writes one and the honest failure is showing it.
   *
   * This DOES hide an older week's debt from the row. That is the point, and it is only safe because
   * the debt is still said in three other places: the week it belongs to, the Drop Ledger, and the
   * Sale Ledger, which is the one that nets a person's whole relationship into one figure.
   */
  weekStart: string | null = null,
): Map<string, CouponsOutstanding> {
  const out = new Map<string, CouponsOutstanding>();
  for (const entry of entries) {
    if (weekStart !== null && entry.weekStart < weekStart) continue;
    // A closed drop is not outstanding. Without this the badge read the party's ARRANGEMENT rather
    // than the ledger, so "30 coupons owed" survived every sale, payment and settlement against it.
    if (!entry.pieces || entry.closed) continue;
    if (entry.owedToYou === 0) continue;
    const seen = out.get(entry.partyId) ?? { toYou: 0 };
    seen.toYou += entry.owedToYou;
    out.set(entry.partyId, seen);
  }
  return out;
}

/** What a coupon row says it is, and how much of it is yours, by loot id. */
export type PieceStatus = Map<string, { status: string; yours: number }>;

/**
 * What each COUPON row says it is, per party, for the pools a screen draws.
 *
 * Off the same entries couponsOwedByParty reads, so a pool and the badge above it cannot disagree
 * about a stack of vestiges. Ordinary drops are absent: their own status IS the answer, and putting
 * a second reading of it in this map would be two answers to one question.
 *
 * A party with no coupon rows is absent rather than empty, which the callers spread as undefined.
 */
export function pieceStatusByParty(entries: DropEntry[]): Map<string, PieceStatus> {
  const out = new Map<string, PieceStatus>();
  for (const entry of entries) {
    if (!entry.pieces) continue;
    const forParty = out.get(entry.partyId) ?? new Map();
    forParty.set(entry.lootId, { status: dropStatusLabel(entry), yours: entry.yours });
    out.set(entry.partyId, forParty);
  }
  return out;
}

/** The log narrowed to one character, or all of it. Totals are recomputed, never scaled. */
export function forCharacter(log: DropLog, characterId: string | null): DropLog {
  if (characterId === null) return log;
  const entries = log.entries.filter((e) => e.characterId === characterId);
  return { entries, totals: totalsOf(entries) };
}

/**
 * The log cut into sections, newest first, each subtotalled.
 *
 * Grouping happens here rather than in buildDropLog because it is a view choice: switching between
 * months and weeks re-heads the same entries, and no total above can move.
 *
 * A week is the reset week the drop fell in, straight off the row. The Thursday boundary is the
 * server's (BossPeriod.kt) and is not recomputed here, so the weeks this heads are the weeks the
 * clears matrix steps through.
 */
export function groupDrops(entries: DropEntry[], grouping: Grouping): DropGroup[] {
  const groups = new Map<string, DropGroup>();
  for (const entry of entries) {
    const key = grouping === "week" ? entry.weekStart : entry.droppedOn.slice(0, 7);
    let group = groups.get(key);
    if (!group) {
      const label = grouping === "week" ? weekLabel(key) : monthLabel(entry.droppedOn);
      group = { key, label, entries: [], pooled: 0, yourTake: 0, usd: { pooled: 0, yourTake: 0 } };
      groups.set(key, group);
    }
    group.entries.push(entry);
    const side = entry.currency === "USD" ? group.usd : group;
    side.pooled += entry.pooled ?? 0;
    side.yourTake += entry.yourTake ?? 0;
  }
  // Insertion order: the entries are newest first, and a group's dates are contiguous, so the
  // sections come out newest first without a second sort.
  return [...groups.values()];
}

/**
 * One line of the log: an ordinary drop, or every row of one stacking drop folded together.
 *
 * Coupons come off a boss apiece and each pool holds its own row, so a week of bossing is the same
 * drop listed five times and the only number anybody wants is the total. Folded here rather than in
 * the page, because the count is the point and a component adding it up would be a second answer.
 */
export type DropLine = {
  /** The drop key when this is a fold, the loot id when it stands for one row. */
  key: string;
  name: string;
  iconUrl: string | null;
  /**
   * How many of it are YOURS, across every row behind this line. What the line shows.
   *
   * Named the same as DropEntry.yours on purpose. This was `quantity` while the entry's `quantity`
   * meant what FELL, and the runs behind a fold were rendered off the wrong one: a line reading 440
   * opened onto runs adding up to 900.
   */
  yours: number;
  /** How many FELL across those rows. Only differs where somebody else took a share. */
  fell: number;
  /** The rows themselves, newest first. Exactly one unless this is a fold. */
  entries: DropEntry[];
  /** True when it stands for more than one row, so the line says how many bosses. */
  folded: boolean;
  /** Summed the way the group subtotals are, and null when there is nothing sold to sum. */
  pooled: number | null;
  yourTake: number | null;
  /** What the two above are in, or null when nothing sold or the rows disagree. See sumSold. */
  currency: Currency | null;
};

/**
 * The log's rows as lines, folding a catalog drop that appears more than once.
 *
 * Only a CATALOG drop folds: free text is whatever somebody typed, and two rows reading "some cape"
 * are not evidence of one drop. Order is kept from the entries, so the fold sits where its newest
 * row was and the log stays newest-first.
 *
 * Inside a fold the runs go by CHARACTER, in `characterOrder`, which is the order the roster is
 * arranged in. Eleven runs newest-first interleaved six characters, so reading one character's
 * night meant picking their rows out of the list. Same argument the party arrangements make, and
 * the same parameter: see consolidate() in lib/parties.ts.
 *
 * The money is summed exactly as a group subtotal is, over `sellerReceives`, which is the one figure
 * that means the same thing on all three bases. See the note at the top of this file.
 */
export function consolidate(entries: DropEntry[], characterOrder: string[]): DropLine[] {
  const byDrop = new Map<string, DropEntry[]>();
  for (const entry of entries) {
    if (entry.dropKey === null) continue;
    const seen = byDrop.get(entry.dropKey);
    if (seen) seen.push(entry);
    else byDrop.set(entry.dropKey, [entry]);
  }

  // A character off the end of the roster sorts last rather than first, which is where a missing
  // index would otherwise put every one of them.
  const rank = new Map(characterOrder.map((id, i) => [id, i]));
  const byCharacter = (a: DropEntry, b: DropEntry) =>
    (rank.get(a.characterId) ?? Number.MAX_SAFE_INTEGER) -
    (rank.get(b.characterId) ?? Number.MAX_SAFE_INTEGER);

  const lines: DropLine[] = [];
  const done = new Set<string>();
  for (const entry of entries) {
    const rows = entry.dropKey === null ? null : byDrop.get(entry.dropKey);
    if (rows === null || rows === undefined || rows.length === 1) {
      lines.push(lineOf(entry.lootId, [entry], false));
      continue;
    }
    if (done.has(entry.dropKey!)) continue;
    done.add(entry.dropKey!);
    // Sorted on a copy: `entries` is the log's own newest-first order and the LINE's place in the
    // list is read off it, so sorting in place would move the fold as well as its runs. A stable
    // sort, so one character's own runs stay newest first inside their group.
    lines.push(lineOf(entry.dropKey!, [...rows].sort(byCharacter), true));
  }
  return lines;
}

/**
 * The distinct names behind a fold, or how many there are once there are too many to read.
 *
 * Names it does not have are left out rather than counted, so the count is only ever of things the
 * line could have named. Eleven coupon rows headed themselves with the first row's character, which
 * is one name standing for six characters' drops.
 */
export function foldNames(
  names: (string | null | undefined)[],
  plural: string,
  max = 3,
): string | null {
  const distinct = [...new Set(names.filter((n): n is string => Boolean(n)))];
  if (distinct.length === 0) return null;
  return distinct.length <= max ? distinct.join(", ") : `${distinct.length} ${plural}`;
}

/**
 * One status for several rows, or how many rows there are when they disagree.
 *
 * Off each row's own reading, not its raw status: a fold of coupon drops that are all already yours
 * agrees, where "in the pool" over it would be the wrong word one level up. Mixed is said as a count
 * because naming one of the statuses would name the wrong half.
 */
export function foldStatus(entries: DropEntry[]): string {
  const statuses = [...new Set(entries.map(dropStatusLabel))];
  return statuses.length === 1 ? statuses[0]! : `${entries.length} runs`;
}

/**
 * What a set of rows made, or null when none of them sold. Summed over `pooled`, per the header.
 *
 * A fold whose rows were sold in DIFFERENT units has no total, and says so rather than adding
 * cents to mesos. Rare (it takes one stacking drop sold both ways) and refused anyway, because the
 * figure it would print is the one this project exists to keep off a screen.
 */
function sumSold(entries: DropEntry[]): {
  pooled: number | null;
  yourTake: number | null;
  currency: Currency | null;
} {
  const sold = entries.filter((e) => e.pooled !== null);
  if (sold.length === 0) return { pooled: null, yourTake: null, currency: null };
  const currency = sold[0]!.currency;
  if (sold.some((e) => e.currency !== currency)) {
    return { pooled: null, yourTake: null, currency: null };
  }
  return {
    pooled: sold.reduce((sum, e) => sum + (e.pooled ?? 0), 0),
    yourTake: sold.reduce((sum, e) => sum + (e.yourTake ?? 0), 0),
    currency,
  };
}

/** One unit's share of a column, so the two are summed apart and never together. */
function sumIn(entries: DropEntry[], currency: Currency, key: "pooled" | "yourTake"): number {
  return entries.reduce((sum, e) => sum + (e.currency === currency ? (e[key] ?? 0) : 0), 0);
}

/**
 * Which side of a run a fold is broken up by. A view choice, like Grouping.
 *
 * Both answer "how many each", off the same rows and to the same total. Which one is useful depends
 * on the question: a week of coupons is either what each character came away with, or what each
 * boss paid out.
 */
export type RunAxis = "character" | "boss";

/** One character's, or one boss's, share of a fold, and the runs it came off. */
export type RunFold = {
  /** The character id or the boss key, per the axis. Null only where the row names no boss. */
  key: string | null;
  /** How many of the drop are theirs, across those runs. Summed like a line's, off `yours`. */
  yours: number;
  /** Their runs, in the order the fold holds them, which is newest first. */
  entries: DropEntry[];
  pooled: number | null;
  yourTake: number | null;
  /** What the two above are in, or null when nothing sold or the rows disagree. See sumSold. */
  currency: Currency | null;
};

/**
 * A fold's rows split down one axis, each subtotalled.
 *
 * The level between a stacking drop and the nights it fell on: six characters clearing five bosses
 * a week is thirty rows behind one chevron, and what is asked of it is how many each, not which
 * Tuesday.
 *
 * By character, order is first appearance, which consolidate() has already put in roster order.
 * Deliberately not re-sorted: two orders for one list is two lists. By boss there is no such
 * pre-sort to walk, so the rows are ordered by `bossOrder` first. Stably, so one boss's runs stay
 * in the roster order underneath it.
 */
export function foldRuns(
  entries: DropEntry[],
  axis: RunAxis,
  bossOrder: Map<string, number> = new Map(),
): RunFold[] {
  // A boss off the end of the catalog sorts last rather than first, which is where a missing index
  // would otherwise put every one of them. Same reasoning as consolidate's roster rank.
  const rankOf = (entry: DropEntry) =>
    bossOrder.get(entry.bossKey ?? "") ?? Number.MAX_SAFE_INTEGER;
  const rows = axis === "character" ? entries : [...entries].sort((a, b) => rankOf(a) - rankOf(b));

  const folds: RunFold[] = [];
  const byKey = new Map<string | null, RunFold>();
  for (const entry of rows) {
    const key = axis === "character" ? entry.characterId : entry.bossKey;
    let fold = byKey.get(key);
    if (!fold) {
      fold = { key, yours: 0, entries: [], pooled: null, yourTake: null, currency: null };
      byKey.set(key, fold);
      folds.push(fold);
    }
    fold.entries.push(entry);
    fold.yours += entry.yours;
  }
  return folds.map((fold) => ({ ...fold, ...sumSold(fold.entries) }));
}

function lineOf(key: string, entries: DropEntry[], folded: boolean): DropLine {
  const first = entries[0]!;
  return {
    key,
    name: first.name,
    iconUrl: first.iconUrl,
    // Yours, not what fell: a log of your drops that counts somebody else's share is the
    // overcount this replaced. What fell is kept beside it rather than lost.
    yours: entries.reduce((sum, e) => sum + e.yours, 0),
    fell: entries.reduce((sum, e) => sum + e.quantity, 0),
    entries,
    folded,
    ...sumSold(entries),
  };
}
