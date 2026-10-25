"use client";

import { useState } from "react";

import { apiFetch, readBack } from "@/lib/api";
import { put } from "@/lib/cache";
import type { SaleRow, BulkSaleBody } from "@/lib/bulk-sale";
import type { PartyLootPool, SellLootBody, SettleBody } from "@/types/loot";
import type { DropLogPage } from "@/types/page";
import type { Person } from "@/types/party";
import type {
  CloseSettlementBody,
  OffsetShares,
  ProceedsDisposal,
  SettlementDebt,
  VestigePayment,
  VestigeSettlement,
  VestigeTranche,
} from "@/types/vestige";

export const POOLS_KEY = "/api/parties/loot";
// The Wallet's settle, reused rather than reimplemented: one act, one endpoint, one set of rows.
export const SETTLE_KEY = "/api/parties/loot/settle";
export const TRANCHES_KEY = "/api/vestige-tranches";
export const PAYMENTS_KEY = "/api/vestige-payments";
export const SETTLEMENTS_KEY = "/api/vestige-settlements";
export const DEBTS_KEY = "/api/settlement-debts";
export const DISPOSALS_KEY = "/api/proceeds-disposals";
export const PEOPLE_KEY = "/api/people";

/** The lists a write can move. Each write answers with the ones it moved, whole. */
export type DropLogPatch = Partial<
  Pick<
    DropLogPage,
    "pools" | "tranches" | "payments" | "settlements" | "debts" | "disposals" | "people"
  >
>;

/**
 * Every write the Drop Log's Sales and Settlement stages make, for whichever screen draws them.
 *
 * Each one answers with the lists the server says it moved, handed to `apply`, so what is on screen
 * is the server's answer and not ours. Rejections are thrown on, never shown here: the card that
 * asked is what the reader is looking at.
 */
export function useDropLogWrites(
  getToken: () => Promise<string | null>,
  apply: (patch: DropLogPatch) => void,
) {
  const [busy, setBusy] = useState(false);

  async function track<T>(job: () => Promise<T>): Promise<T> {
    setBusy(true);
    try {
      return await job();
    } finally {
      setBusy(false);
    }
  }

  const call = <T>(path: string, options: RequestInit) => apiFetch<T>(path, options, getToken);

  /**
   * Records one tranche, or removes one.
   *
   * Both answer with the whole tally rather than the row touched, because the queue is re-spent
   * from all of it: a sale entered now can be what covers a boss cleared in July, and redrawing
   * from one row would be guessing at where its pieces landed.
   */
  const saleWrite = (path: string, options: RequestInit) =>
    track(async () => apply({ tranches: await call<VestigeTranche[]>(path, options) }));

  /** The same, for closing a pile's books. See V52. */
  const settlementWrite = (path: string, options: RequestInit) =>
    track(async () => apply({ settlements: await call<VestigeSettlement[]>(path, options) }));

  /** The same, for an entered debt. Its own list, because it touches no drop at all. See V56. */
  const debtWrite = (path: string, options: RequestInit) =>
    track(async () => apply({ debts: await call<SettlementDebt[]>(path, options) }));

  /** The same, for deciding what became of money a sale of their coupons left you holding. See V61. */
  const disposalWrite = (path: string, options: RequestInit) =>
    track(async () => apply({ disposals: await call<ProceedsDisposal[]>(path, options) }));

  /** The same, for a receipt. Its own list, because a payment changes no piece. See V51. */
  const paymentWrite = (path: string, options: RequestInit) =>
    track(async () => apply({ payments: await call<VestigePayment[]>(path, options) }));

  /**
   * Marks a person's unpaid SHARES paid, which is the other half of a settlement.
   *
   * The Wallet's own act, against the same payout rows, rather than a second way to mark a share
   * paid: two of those would disagree the first time one of them was changed.
   */
  async function settleShares(payouts: { lootId: string; memberId: string }[]) {
    if (payouts.length === 0) return;
    const body: SettleBody = { payouts };
    await track(async () =>
      apply({
        pools: await call<PartyLootPool[]>(SETTLE_KEY, {
          method: "POST",
          body: JSON.stringify(body),
        }),
      }),
    );
  }

  /**
   * A closing act, whole: the shares it settles and their coupon money, in one write.
   *
   * Not built from the other writes, and it must not be. Each of those draws the moment it lands,
   * and every list this act moves comes off what they owe you, so two of them in a row is one
   * button walking one figure down in two steps. One answer, one `apply`, one repaint.
   */
  async function closeWrite(act: "offset" | "sent", body: CloseSettlementBody) {
    if (body.parts.length === 0 && body.holding === undefined) return;
    await track(async () => {
      const done = await call<OffsetShares>(`${DEBTS_KEY}/${act}`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      apply({ pools: done.pools, debts: done.debts, disposals: done.disposals });
    });
  }

  /** Answers with the whole people list, so the pins redraw from what the server stored. */
  async function pin(personId: string, pinned: boolean) {
    await track(async () => {
      const people = await call<Person[]>(`${PEOPLE_KEY}/${personId}/pinned`, {
        method: "PUT",
        body: JSON.stringify({ pinned }),
      });
      apply({ people });
      put(PEOPLE_KEY, people);
    });
  }

  /**
   * Prices a pile of one interchangeable drop across every pool it sits in.
   *
   * Answers with the pools, so the rows redraw from what the server actually wrote rather than from
   * the proposal that was confirmed. All of them or none: see bulkSaleRoute.
   */
  const bulkSale = (body: BulkSaleBody) =>
    track(async () =>
      apply({
        pools: await call<PartyLootPool[]>("/api/parties/loot/bulk-sale", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      }),
    );

  /**
   * Prices ONE row, where the drop has its own price and no queue could say which copy went.
   *
   * The party page's own sale route, so a ring priced here and a ring priced on Party View are one
   * write and cannot come out differently. Answers with the pools, which is what takes the card off
   * the list.
   */
  const rowSale = (row: SaleRow, body: SellLootBody) =>
    track(async () => {
      await call<unknown>(`/api/parties/${row.partyId}/loot/${row.lootId}/sale`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
      // The sale is in from here, so a failed refetch is the list going stale. See StaleAfterWrite.
      await readBack(async () => apply({ pools: await call<PartyLootPool[]>(POOLS_KEY, {}) }));
    });

  return {
    busy,
    track,
    saleWrite,
    settlementWrite,
    debtWrite,
    disposalWrite,
    paymentWrite,
    settleShares,
    closeWrite,
    pin,
    bulkSale,
    rowSale,
  };
}

export type DropLogWrites = ReturnType<typeof useDropLogWrites>;
