import { describe, expect, it } from "vitest";
import { closeBody, closeLabel, closingActs } from "@/components/closing-acts";
import { formatMesos } from "@/lib/drop-split";
import { formatDollars } from "@/lib/money";
import type { ClosingNet } from "@/lib/settlement";

// The one builder both Settlement cards draw Closing Actions from. The rules are Jonathan's of
// 2026-10-25; closingNet's own figures are pinned in settlement.test.ts.

const M = 1_000_000;
const share = (lootId: string, amount: number, currency = "MESO") => ({
  lootId,
  memberId: `seat-${lootId}`,
  amount,
  currency,
});
const net = (over: Partial<ClosingNet>): ClosingNet => ({
  mesos: 0,
  payer: null,
  sharesYouOwe: [],
  sharesTheyOwe: [],
  holding: 0,
  heldByThem: 0,
  usdYouOwe: 0,
  usdTheyOwe: 0,
  enteredBalance: 0,
  open: true,
  ...over,
});
const keys = (n: ClosingNet, listings = false) =>
  closingActs({
    net: n,
    name: "Owen",
    detail: null,
    close: () => {},
    listings: listings
      ? {
          kit: {
            listings: [],
            busy: false,
            post: async () => {},
            remove: async () => {},
            image: async () => new Blob(),
          },
          yours: null,
          theirs: null,
          post: () => {},
          replace: async () => {},
          remove: () => {},
        }
      : undefined,
  }).map((act) => `${act.key}:${act.label}`);

describe("what each closing act says", () => {
  it("names what the payer sends", () => {
    expect(closeLabel(net({ payer: "YOU", mesos: 2_000 * M }))).toBe(
      `Mark ${formatMesos(2_000 * M, true)} Sent`,
    );
  });

  it("names what the payee receives", () => {
    expect(closeLabel(net({ payer: "THEM", mesos: 800 * M }))).toBe(
      `Mark ${formatMesos(800 * M, true)} Received`,
    );
  });

  it("names dollars beside the mesos, never added to them", () => {
    expect(closeLabel(net({ payer: "YOU", mesos: 700 * M, usdYouOwe: 30_000 }))).toBe(
      `Mark ${formatMesos(700 * M, true)} and ${formatDollars(30_000)} Sent`,
    );
  });

  it("names dollars running the other way as received, after what the reader sends", () => {
    expect(closeLabel(net({ payer: "YOU", mesos: 700 * M, usdTheyOwe: 10_000 }))).toBe(
      `Mark ${formatMesos(700 * M, true)} Sent, ${formatDollars(10_000)} Received`,
    );
  });

  it("settles an even pair with nothing crossing", () => {
    expect(closeLabel(net({}))).toBe("Mark Settled");
  });
});

describe("which acts each side is offered", () => {
  it("offers the payer Mark Sent alone, with no debt to offset against", () => {
    expect(keys(net({ payer: "YOU", mesos: 2_000 * M }), true)).toEqual([
      `close:Mark ${formatMesos(2_000 * M, true)} Sent`,
    ]);
  });

  it("offers the payer an Offset too where they are owed an entered debt", () => {
    expect(keys(net({ payer: "YOU", mesos: 2_000 * M, enteredBalance: 5_000 * M }))).toEqual([
      `offset:Offset ${formatMesos(2_000 * M, true)}`,
      `close:Mark ${formatMesos(2_000 * M, true)} Sent`,
    ]);
  });

  it("offers the payee Mark Received and a listing, for a trade now or a sale later", () => {
    expect(keys(net({ payer: "THEM", mesos: 800 * M }), true)).toEqual([
      `close:Mark ${formatMesos(800 * M, true)} Received`,
      `listing:Post Listing for ${formatMesos(800 * M, true)}`,
    ]);
  });

  it("offers an even pair Mark Settled, and no listing, there being nothing to pay", () => {
    expect(keys(net({}), true)).toEqual(["close:Mark Settled"]);
  });

  it("offers nothing on a card with nothing for a closing act to settle", () => {
    expect(keys(net({ open: false }), true)).toEqual([]);
  });
});

describe("what one press sends", () => {
  const both = net({
    payer: "YOU",
    mesos: 1_000 * M,
    sharesYouOwe: [share("a", 2_000 * M), share("u", 30_000, "USD")],
    sharesTheyOwe: [share("d", 500 * M)],
    heldByThem: 500 * M,
  });

  it("closes every pot both ways in one body, held money absent where there is none", () => {
    expect(closeBody(both, "PAID")).toEqual({
      parts: [
        { lootId: "a", memberId: "seat-a" },
        { lootId: "u", memberId: "seat-u" },
      ],
      received: [{ lootId: "d", memberId: "seat-d" }],
      holding: undefined,
      heldByThem: 500 * M,
    });
  });

  it("prices only the meso shares into an offset, an entry being a meso ledger", () => {
    expect(closeBody(both, "OFFSET").parts).toEqual([
      { lootId: "a", memberId: "seat-a", amount: 2_000 * M },
    ]);
  });
});
