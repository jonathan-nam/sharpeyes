"use client";

import { apiAssetUrl } from "@/lib/api";
import { bossLabel } from "@/lib/boss-difficulty";
import { formatDropped } from "@/lib/loot";
import type { LotRow } from "@/lib/lot-sale";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";

/**
 * Drops you ran that somebody else logged, and so sells. Read-only: the sale is theirs to record,
 * and it leaves this list when they do.
 */
export function OthersSales({
  rows,
  bossByKey,
  partyById,
}: {
  rows: LotRow[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="loot-pool">
      <h2 className="loot-pool-title">Logged by Others</h2>
      <ul className="loot-shares">
        {rows.map((row) => {
          const boss = bossByKey.get(row.bossKey ?? "");
          const party = partyById.get(row.partyId);
          return (
            <li key={row.lootId} className="loot-sale-row">
              {row.iconUrl ? (
                <img className="loot-icon" src={apiAssetUrl(row.iconUrl)} alt="" />
              ) : (
                <span className="loot-icon" aria-hidden="true" />
              )}
              <div className="ledger-offset-text">
                <span className="loot-share-name">
                  {row.units > 1 ? `${row.name} ×${row.units}` : row.name}
                </span>
                <span className="loot-meta">
                  {[
                    boss ? bossLabel(boss.name, party?.difficulty ?? null) : null,
                    formatDropped(row.droppedOn),
                    row.loggedBy ? `Logged by ${row.loggedBy}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
                {/* Who ran it that night, which is who its sale will divide between. */}
                <span className="loot-meta">{row.ran.map((seat) => seat.name).join(", ")}</span>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
