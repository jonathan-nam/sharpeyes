"use client";

import { useState } from "react";
import { Button } from "@/components/button";
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
import { isMine } from "@/lib/wallet";

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
  onKeep,
  onRemove,
}: {
  rows: SaleRow[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  characterById: Map<string, Character>;
  busy: boolean;
  onSell: (row: SaleRow, body: SellLootBody) => Promise<void>;
  onKeep: (row: SaleRow, memberId: string) => Promise<void>;
  onRemove: (row: SaleRow) => Promise<void>;
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
          onKeep={onKeep}
          onRemove={onRemove}
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
  onKeep,
  onRemove,
}: {
  row: SaleRow;
  boss: Boss | null;
  party: Party | null;
  characterName: string | null;
  busy: boolean;
  onSell: (row: SaleRow, body: SellLootBody) => Promise<void>;
  onKeep: (row: SaleRow, memberId: string) => Promise<void>;
  onRemove: (row: SaleRow) => Promise<void>;
}) {
  const [refusal, setRefusal] = useState<string | null>(null);

  // The party is what the form's controls are read against, so without it there is no card to draw.
  // rowSales only returns rows whose party it found, which is what makes this unreachable rather
  // than a case with a message.
  if (party === null) return null;

  async function attempt(write: () => Promise<void>) {
    setRefusal(null);
    try {
      await write();
    } catch (e) {
      setRefusal(failureText(e, "That didn't save. Try again."));
    }
  }
  // A drop you got solo owes nobody, so keeping it is not a sale. Same rule as keptSolo. Every card
  // here is a drop you logged and nobody has sold or kept, which mayDeleteLoot lets you remove.
  const keepers = row.solo ? row.ran.filter(isMine) : [];

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
        onSell={(body) => void attempt(() => onSell(row, body))}
        actions={
          <>
            {keepers.map((m) => (
              <Button
                key={m.id}
                variant="secondary"
                onClick={() => void attempt(() => onKeep(row, m.id))}
                disabled={busy}
              >
                {keepers.length === 1 ? "Keep" : `${m.name} Kept It`}
              </Button>
            ))}
            <button
              type="button"
              className="party-delete"
              onClick={() => void attempt(() => onRemove(row))}
              disabled={busy}
            >
              Remove
            </button>
          </>
        }
      />

      {refusal && <span className="split-error">{refusal}</span>}
    </section>
  );
}
