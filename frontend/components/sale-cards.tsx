"use client";

import { BulkSale } from "@/components/bulk-sale";
import { RowSale } from "@/components/row-sale";
import type { BulkDrop, SaleRow } from "@/lib/bulk-sale";
import type { DropLogWrites } from "@/lib/use-drop-log-writes";
import type { DropLogPage } from "@/types/page";

/**
 * Every sale card for your drops: the piles of interchangeable drops, then the drops that price
 * alone, against the two writes in useDropLogWrites.
 *
 * Cards only. A heading over these belongs to whatever else is drawn under it.
 */
export function SaleCards({
  page,
  bulk,
  alone,
  writes,
}: {
  page: Pick<DropLogPage, "parties" | "bosses" | "characters">;
  /** See saleQueues. Passed in because the Sales tab also counts them. */
  bulk: BulkDrop[];
  alone: SaleRow[];
  writes: Pick<DropLogWrites, "busy" | "bulkSale" | "rowSale">;
}) {
  const bossByKey = new Map(page.bosses.map((b) => [b.bossKey, b]));
  const partyById = new Map(page.parties.map((p) => [p.id, p]));
  const characterById = new Map(page.characters.map((c) => [c.id, c]));
  return (
    <>
      <BulkSale
        drops={bulk}
        bossByKey={bossByKey}
        partyById={partyById}
        busy={writes.busy}
        onSell={writes.bulkSale}
      />
      {/* After the bulk sales, which are one card per drop however many rows each covers, so the shorter
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
