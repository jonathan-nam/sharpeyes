"use client";

import { useState } from "react";
import { LootSaleForm } from "@/components/loot-sale-form";
import { apiAssetUrl, failureText } from "@/lib/api";
import { bossLabel } from "@/lib/boss-difficulty";
import { formatDropped } from "@/lib/loot";
import type { SaleRow } from "@/lib/bulk-sale";
import type { SellLootBody } from "@/types/loot";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { Party } from "@/types/party";
import { sellersOf } from "@/lib/sale-logger";

// One card per unsold drop that prices ALONE, and the form that prices it.
//
// The other half of the Sale Ledger's bulk sales. A drop whose copies are interchangeable is sold
// as a pile and the rows are proposed; a drop with its own potential lines has its own price, so a queue
// could only guess which one went and the card names ONE row instead. See rowSales.
//
// The row is named in full, because these cards stand together across every party you keep: the
// boss with its difficulty, whose pool it is in, and the day it fell. Nothing else on the card
// would say which of two rings this is.
//
// Nothing here divides anything. It is LootSaleForm's boxes and the party page's own sale route, so
// a ring priced here and a ring priced on Party View are one write.

export function RowSale({
  rows,
  bossByKey,
  partyById,
  characterById,
  busy,
  onSell,
}: {
  rows: SaleRow[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  characterById: Map<string, Character>;
  busy: boolean;
  onSell: (row: SaleRow, body: SellLootBody) => Promise<void>;
}) {
  // Cards only. The "Outstanding Sales" heading covers these, the bulk sales and the coupon piles, so it
  // belongs to whatever draws all three.
  if (rows.length === 0) return null;
  return (
    <>
      {rows.map((row) => (
        <RowCard
          key={row.lootId}
          row={row}
          boss={bossByKey.get(row.bossKey ?? "") ?? null}
          party={partyById.get(row.partyId) ?? null}
          characterName={characterById.get(row.characterId)?.name ?? null}
          busy={busy}
          onSell={onSell}
        />
      ))}
    </>
  );
}

function RowCard({
  row,
  boss,
  party,
  characterName,
  busy,
  onSell,
}: {
  row: SaleRow;
  boss: Boss | null;
  party: Party | null;
  characterName: string | null;
  busy: boolean;
  onSell: (row: SaleRow, body: SellLootBody) => Promise<void>;
}) {
  const [refusal, setRefusal] = useState<string | null>(null);

  // The party is what the form's controls are read against, so without it there is no card to draw.
  // rowSales only returns rows whose party it found, which is what makes this unreachable rather
  // than a case with a message.
  if (party === null) return null;

  async function sell(body: SellLootBody) {
    setRefusal(null);
    try {
      await onSell(row, body);
    } catch (e) {
      setRefusal(failureText(e, "That didn't save. Try again."));
    }
  }

  return (
    <section className="ledger-card">
      <header className="ledger-head">
        {row.iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(row.iconUrl)} alt="" />
        ) : (
          // The drop has no official art (see catalog/drops.yaml). An empty frame keeps the card
          // aligned with the ones that do.
          <span className="loot-icon" aria-hidden="true" />
        )}
        <span className="loot-title">
          <span className="loot-name">
            {row.name}
            {row.units > 1 && <span className="loot-count"> ×{row.units}</span>}
          </span>
          <span className="loot-meta">
            {[
              boss ? bossLabel(boss.name, party.difficulty) : null,
              characterName,
              formatDropped(row.droppedOn),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </span>
      </header>

      <LootSaleForm
        // The seats that RAN the week it fell, not the party as it stands now: the sale route
        // refuses a seller who was not there.
        ran={row.ran}
        sellers={sellersOf(row.ran, party.yours === false)}
        busy={busy}
        labelled
        onSell={(body) => void sell(body)}
      />

      {refusal && <span className="split-error">{refusal}</span>}
    </section>
  );
}
