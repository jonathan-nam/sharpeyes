"use client";

import { LotSale } from "@/components/lot-sale";
import { RowSale } from "@/components/row-sale";
import type { LotDrop, LotRow } from "@/lib/lot-sale";
import type { DropLogWrites } from "@/lib/use-drop-log-writes";
import type { DropLogPage } from "@/types/page";

/**
 * Every sale card for your drops: the piles of interchangeable drops, then the drops that price
 * alone. The Sales tab and the home screen both draw this, against the same two writes.
 *
 * Cards only. A heading over these belongs to whatever else is drawn under it.
 */
export function SaleCards({
  page,
  lots,
  alone,
  writes,
}: {
  page: Pick<DropLogPage, "parties" | "bosses" | "characters">;
  /** See saleQueues. Passed in because the Sales tab also counts them. */
  lots: LotDrop[];
  alone: LotRow[];
  writes: Pick<DropLogWrites, "busy" | "lotSale" | "rowSale">;
}) {
  const bossByKey = new Map(page.bosses.map((b) => [b.bossKey, b]));
  const partyById = new Map(page.parties.map((p) => [p.id, p]));
  const characterById = new Map(page.characters.map((c) => [c.id, c]));
  return (
    <>
      <LotSale
        drops={lots}
        bossByKey={bossByKey}
        partyById={partyById}
        busy={writes.busy}
        onSell={writes.lotSale}
      />
      {/* After the lots, which are one card per drop however many rows each covers, so the shorter
          list is the one on top. */}
      <RowSale
        rows={alone}
        bossByKey={bossByKey}
        partyById={partyById}
        characterById={characterById}
        busy={writes.busy}
        onSell={writes.rowSale}
      />
    </>
  );
}
