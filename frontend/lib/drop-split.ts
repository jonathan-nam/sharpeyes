// Splitting boss drop money, and the tax that makes it not-division.
//
// The Auction House takes a cut of every sale: 5%, or 3% for MVP. One person sells the drop and
// pays that once. If they then pay the party through the AH, every meso a member receives has
// been taxed TWICE and the seller's own share only once. Naive division looks fair and is not.
//
//   lazy  the seller divides what landed in their inventory by the party size and sends that.
//         Cheap to reason about, and the seller quietly keeps a whole fee more than everyone else.
//   fair  the seller sends each member more than they keep, sized so that AFTER the second tax
//         every member nets exactly what the seller kept.
//
// Both are offered because "lazy" is what most parties actually do, and a tool that only showed
// the fair number could not tell you what it was costing you.
//
// The fee on the PAYOUT hop is the RECEIVING member's, not the seller's: to move mesos through the
// AH the member lists and the seller buys, so it is the member who is selling and the member whose
// MVP status applies. Hence a rate per member rather than one rate for the room.

/** The two rates the Auction House charges. MVP pays the lower one. */
export const FEE_MVP = 0.03;
export const FEE_STANDARD = 0.05;

export type SplitMethod = "lazy" | "fair";

/**
 * Which end of the sale the entered figure is.
 *
 * `received` makes `sellerFee` irrelevant: the fee only ever existed to turn a listed price into
 * what landed in your inventory, and if you type the latter there is nothing left for it to do.
 * The gross is NOT inferred back from it, because that would put a figure on screen the tool was
 * told, not shown.
 */
export type AmountBasis = "listed" | "received";

export type SplitInput = {
  /** The figure entered, read according to `amountIs`. */
  amount: number;
  amountIs: AmountBasis;
  /** The seller's own rate, charged on the sale. Ignored when `amountIs` is `received`. */
  sellerFee: number;
  /** One rate per OTHER party member. Its length is the party size less the seller. */
  memberFees: number[];
  method: SplitMethod;
  /** The seller's own share count. Absent is 1, which is an even split. */
  sellerShares?: number;
  /** One share count per OTHER member, positional with `memberFees`. Absent is 1 each. */
  memberShares?: number[];
  /**
   * Which way a payout that will not divide evenly is rounded. Absent is `up`, which is mesos.
   *
   * The dust has to land on somebody, and the two units want it in different places. In MESOS it
   * goes to the party: a meso or two is nothing, the distributor is the one who should eat it, and
   * it matches the split bot people already cross-check against.
   *
   * In DOLLARS it goes to the holder, because the figure is read by a human who has already done
   * the division. $1000 three ways is $333.33 to everybody, and paying $333.34 makes every number
   * on the screen disagree with the one in their head over a cent nobody cares about. The holder
   * keeps $333.34 instead, which is the one figure nobody is checking.
   */
  rounding?: "up" | "down";
};

export type MemberShare = {
  fee: number;
  /** How many shares of the pot this member takes. 1 in an even split. */
  shares: number;
  /** Mesos to send this member, before the fee on that transfer. */
  pay: number;
  /** What they actually end up holding. */
  nets: number;
};

export type Split = {
  /** What the drop was listed at, or null when only the received figure is known. */
  grossSale: number | null;
  /** What the seller has to hand out. */
  sellerReceives: number;
  /** What the seller is left holding, after absorbing the rounding dust. */
  sellerKeeps: number;
  /** The seller's own share count, as used. */
  sellerShares: number;
  /**
   * What one share nets on a fair split, before it is grossed up for the receiver's fee. Zero on a
   * lazy split, which never solves for it.
   */
  netPerShare: number;
  members: MemberShare[];
  /** Lost to the AH: both hops when the listed price is known, the payouts alone when it is not. */
  totalFee: number;
  /** False when `totalFee` covers the payouts only, so a caller cannot label it as the whole cost. */
  totalFeeCoversSale: boolean;
};

const SUFFIX: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/**
 * Reads a sale price the way a player would say it: `1b`, `9.5b`, `970m`, `1,000,000,000`.
 *
 * Returns null for anything it cannot read, INCLUDING partial input, so the caller shows nothing
 * rather than a number derived from half a figure. Boss drops are nine and ten digit numbers and
 * typing one out in full is where a zero goes missing.
 */
export function parseMesos(input: string): number | null {
  const cleaned = input
    .trim()
    .toLowerCase()
    .replace(/[,_\s]/g, "");
  if (cleaned === "") return null;
  const match = /^(\d+(?:\.\d+)?)([kmb])?$/.exec(cleaned);
  if (!match?.[1]) return null;
  const suffix = match[2];
  const value = Number(match[1]) * (suffix ? (SUFFIX[suffix] ?? 1) : 1);
  return Number.isFinite(value) ? Math.round(value) : null;
}

/**
 * Throws on a rate outside [0, 1) or a negative price rather than returning a number nobody should
 * act on. A rate of 1 would mean the AH takes everything, and dividing by what is left is where an
 * Infinity would enter and be rendered as a payout.
 *
 * Shares are the same kind of refusal. A `memberShares` of the wrong length would silently pay some
 * members a share they never agreed to, so it is rejected rather than padded.
 *
 * Both units are integers, so a payout that will not divide evenly is rounded and somebody absorbs
 * the dust. Which way, and therefore who, is `rounding`: up and the distributor eats it, which is
 * the meso rule, or down and the holder keeps it, which is the dollar one.
 */
export function splitDrop({
  amount,
  amountIs,
  sellerFee,
  memberFees,
  method,
  sellerShares = 1,
  memberShares,
  rounding = "up",
}: SplitInput): Split {
  // The seller's own rate is unused on a `received` basis, so a nonsense value there must not
  // reject input the split does not depend on.
  const rates = amountIs === "listed" ? [sellerFee, ...memberFees] : memberFees;
  for (const fee of rates) {
    if (!Number.isFinite(fee) || fee < 0 || fee >= 1) {
      throw new RangeError(`fee must be at least 0 and below 1, got ${fee}`);
    }
  }
  if (!Number.isFinite(amount) || amount < 0) {
    throw new RangeError(`amount must be zero or more, got ${amount}`);
  }

  const shares = memberShares ?? memberFees.map(() => 1);
  if (shares.length !== memberFees.length) {
    throw new RangeError(`memberShares must be one per member, got ${shares.length}`);
  }
  for (const count of [sellerShares, ...shares]) {
    if (!Number.isInteger(count) || count < 0) {
      throw new RangeError(`a share count must be a whole number of 0 or more, got ${count}`);
    }
  }
  // Zero is a seat that takes nothing, which is a real arrangement. Everybody on zero is not: it
  // divides the pot by nothing, and a split that pays no one is a question rather than an answer.
  if (sellerShares + shares.reduce((sum, count) => sum + count, 0) < 1) {
    throw new RangeError("at least one seat has to take a share");
  }

  const entered = Math.floor(amount);
  const grossSale = amountIs === "listed" ? entered : null;
  const sellerReceives = amountIs === "listed" ? Math.floor(entered * (1 - sellerFee)) : entered;

  // Fair, with a rate per member and a share count per seat. Every SHARE is to be worth the same X
  // afterwards, so the seller keeps X times their own shares and must send member i enough that
  // X * shares_i survives THEIR fee. Those have to add up to what the seller is holding:
  //   X * shares_s + SUM X * shares_i / (1 - fee_i) = received
  // so X = received / (shares_s + SUM shares_i / (1 - fee_i)). All shares at 1 collapses this to
  // the even-split formula, which is what the equal-share tests pin.
  //
  // A party of one gets zero, not the whole purse: with nobody to send to there is no share to
  // price, and a figure here would make the two methods differ on a pool that cannot split.
  const netPerShare =
    method === "fair" && memberFees.length > 0
      ? sellerReceives /
        (sellerShares + memberFees.reduce((sum, fee, i) => sum + (shares[i] ?? 1) / (1 - fee), 0))
      : 0;

  const totalShares = sellerShares + shares.reduce((sum, count) => sum + count, 0);
  const exact = (fee: number, count: number) =>
    method === "fair" ? (netPerShare * count) / (1 - fee) : (sellerReceives * count) / totalShares;
  const payouts = (round: (n: number) => number) =>
    memberFees.map((fee, i) => round(exact(fee, shares[i] ?? 1)));

  // Which way the dust lands, per `rounding`. See its note for why the two units differ.
  //
  // Rounding UP can OVERSHOOT what the seller is holding, though only on amounts too small to
  // divide: 1 meso across a party of 6 rounds to 1 each and pays out 5 from a purse of 1. Falling
  // back to floor is the only branch where the invariant would otherwise break. Rounding DOWN
  // cannot overshoot at all, so for dollars that branch is dead rather than merely unused.
  let pays = payouts(rounding === "up" ? Math.ceil : Math.floor);
  if (pays.reduce((sum, p) => sum + p, 0) > sellerReceives) pays = payouts(Math.floor);

  const members = memberFees.map((fee, i) => {
    const pay = pays[i] ?? 0;
    return { fee, shares: shares[i] ?? 1, pay, nets: Math.floor(pay * (1 - fee)) };
  });

  const paidOut = members.reduce((sum, m) => sum + m.pay, 0);
  const sellerKeeps = sellerReceives - paidOut;
  const received = members.reduce((sum, m) => sum + m.nets, 0);

  return {
    grossSale,
    sellerReceives,
    sellerKeeps,
    sellerShares,
    netPerShare,
    members,
    totalFee: (grossSale ?? sellerReceives) - sellerKeeps - received,
    totalFeeCoversSale: grossSale !== null,
  };
}

/** One line of the working: a name, and the arithmetic that produced it. */
export type MathStep = {
  /** What is being computed. */
  label: string;
  /** The arithmetic, with this split's own numbers and its result. */
  expression: string;
};

/**
 * Mesos as digits, ungrouped by default.
 *
 * The figures here get typed or pasted into the game's own price box, which takes digits and
 * nothing else. Grouping them is a display choice the caller opts into, not the default, because
 * the default is the one people copy.
 */
export function formatMesos(value: number, grouped = false): string {
  return grouped ? value.toLocaleString("en-US") : String(value);
}

/**
 * Mesos the way they are said out loud: `1.45b`, `970m`, `25m`.
 *
 * The inverse of what parseMesos reads, and for the one job that figure cannot do: recapping what
 * was already entered. Never use it for a figure somebody is meant to send. It rounds, and a
 * rounded payout is the wrong payout.
 */
export function shortMesos(value: number): string {
  const abs = Math.abs(value);
  const [unit, suffix] = abs >= 1e9 ? [1e9, "b"] : abs >= 1e6 ? [1e6, "m"] : [1e3, "k"];
  if (abs < 1e3) return String(Math.round(value));
  // Two decimals at most, and no trailing zeroes: 1.45b, 1.4b, 1b.
  return `${Number((value / unit).toFixed(2))}${suffix}`;
}
const keptOf = (fee: number) => (1 - fee).toFixed(2);

/**
 * The arithmetic behind a split, in the order it was done.
 *
 * Reads every figure off the `Split` it is given rather than recomputing them. A hand-written
 * explanation beside a computed number is two sources of truth, and the one nobody runs is the
 * one that goes wrong. A test pins that every payout it computed appears in here.
 */
export function explainSplit(
  input: SplitInput,
  split: Split,
  { grouped = false }: { grouped?: boolean } = {},
): MathStep[] {
  const n = (value: number) => formatMesos(value, grouped);
  const { sellerFee, memberFees, method } = input;
  const others = memberFees.length;
  const steps: MathStep[] = [
    {
      label: "received",
      expression:
        split.grossSale !== null
          ? `${n(split.grossSale)} x ${keptOf(sellerFee)} = ${n(split.sellerReceives)}`
          : `${n(split.sellerReceives)} (entered)`,
    },
  ];

  if (others === 0) {
    steps.push({ label: "you keep", expression: n(split.sellerKeeps) });
    return steps;
  }

  // Even shares are what makes the one-line form true. A seat on a double share pays out a
  // different figure from its neighbours even at one rate, so it takes the line-per-member form
  // below and the share count goes in the line: without it the numbers look arbitrary.
  const evenShares = split.sellerShares === 1 && split.members.every((m) => m.shares === 1);
  const uniform = memberFees.every((fee) => fee === memberFees[0]) && evenShares;
  const fee = memberFees[0] ?? 0;
  const totalShares = split.sellerShares + split.members.reduce((sum, m) => sum + m.shares, 0);
  const paidOut = split.members.reduce((sum, m) => sum + m.pay, 0);
  const netted = split.members.reduce((sum, m) => sum + m.nets, 0);

  if (method === "fair") {
    const divisor =
      split.sellerShares + split.members.reduce((sum, m) => sum + m.shares / (1 - m.fee), 0);
    steps.push({
      label: evenShares ? "X" : "X per share",
      expression: uniform
        ? `${n(split.sellerReceives)} / (1 + ${others} / ${keptOf(fee)}) = ${n(
            Math.floor(split.netPerShare),
          )}`
        : `${n(split.sellerReceives)} / ${divisor.toFixed(4)} = ${n(Math.floor(split.netPerShare))}`,
    });
  } else if (!evenShares) {
    // A lazy split solves for nothing, so with uneven shares there is no line saying where a
    // payout came from unless one share is priced first.
    steps.push({
      label: "per share",
      expression: `${n(split.sellerReceives)} / ${totalShares} = ${n(
        Math.floor(split.sellerReceives / totalShares),
      )}`,
    });
  }

  // One line for the party when they all pay the same, which is the usual case. Only a mixed
  // party needs a line each, and then the rate has to be in it or the numbers look arbitrary.
  if (uniform) {
    steps.push(
      {
        label: "send each",
        expression:
          method === "fair"
            ? `${n(Math.floor(split.sellerReceives / (1 + memberFees.reduce((sum, f) => sum + 1 / (1 - f), 0))))} / ${keptOf(fee)} = ${n(split.members[0]?.pay ?? 0)}`
            : `${n(split.sellerReceives)} / ${others + 1} = ${n(split.members[0]?.pay ?? 0)}`,
      },
      {
        label: "they keep",
        expression: `${n(split.members[0]?.pay ?? 0)} x ${keptOf(fee)} = ${n(split.members[0]?.nets ?? 0)}`,
      },
    );
  } else {
    split.members.forEach((m, i) => {
      const on = m.shares === 1 ? "" : `${m.shares} shares: `;
      steps.push({
        label: `member ${i + 1}`,
        expression: `${on}send ${n(m.pay)} x ${keptOf(m.fee)} = ${n(m.nets)}`,
      });
    });
  }

  steps.push({
    label: "you keep",
    expression: uniform
      ? `${n(split.sellerReceives)} - ${others} x ${n(split.members[0]?.pay ?? 0)} = ${n(split.sellerKeeps)}`
      : `${split.sellerShares === 1 ? "" : `${split.sellerShares} shares: `}${n(
          split.sellerReceives,
        )} - ${n(paidOut)} = ${n(split.sellerKeeps)}`,
  });

  steps.push({
    label: "check",
    expression: `${n(split.sellerKeeps)} + ${n(netted)} + ${n(split.totalFee)} = ${n(
      split.grossSale ?? split.sellerReceives,
    )}`,
  });

  return steps;
}
