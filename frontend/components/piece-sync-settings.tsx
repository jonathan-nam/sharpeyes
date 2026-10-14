"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/use-auth";
import { apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { InfoBubble } from "@/components/info-bubble";
import { gapLine, shownGaps } from "@/lib/piece-sync";
import type { PieceSync, SavePieceSyncBody } from "@/types/piece-sync";

const KEY = "/api/tokens/sync";

/** The inventory's settings: whether a boss clear adds its Eternal pieces. */
export function PieceSyncSettings() {
  const { getToken, isLoaded } = useAuth();
  const [sync, setSync] = useState<PieceSync | null>(peek<PieceSync>(KEY) ?? null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Not before auth answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    apiFetch<PieceSync>(KEY, { method: "GET" }, getToken)
      .then((result) => {
        setSync(result);
        put(KEY, result);
      })
      .catch(() => {
        /* keep what we have */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  async function save(enabled: boolean) {
    setSaving(true);
    try {
      const body: SavePieceSyncBody = { enabled };
      const result = await apiFetch<PieceSync>(
        KEY,
        { method: "PUT", body: JSON.stringify(body) },
        getToken,
      );
      setSync(result);
      put(KEY, result);
    } catch {
      // The box stays as the server last said, which is what `checked` reads.
    } finally {
      setSaving(false);
    }
  }

  if (sync === null) return null;

  return (
    <section className="inventory-settings">
      <h2 className="night-heading">Settings</h2>
      <div className="inventory-sync-row">
        <label className="night-toggle">
          <input
            type="checkbox"
            checked={sync.enabled}
            disabled={saving}
            onChange={(e) => void save(e.target.checked)}
          />
          <span>Auto Sync Eternal Pieces with Boss Clears</span>
        </label>
        {/* Outside the label, so pressing it cannot tick the box. */}
        <InfoBubble label="How auto sync works">
          <ul className="info-bubble-list">
            <li>
              Ticking a boss cleared adds its pieces at its difficulty. Unticking takes them back.
            </li>
            <li>A solo Kalos, Kaling, First Adversary or Malefic Star adds the whole pile.</li>
            <li>
              A party&apos;s pile for those four is added on Party View, split by the party&apos;s
              piece ratio.
            </li>
            <li>Clears from before sync was turned on are not added.</li>
          </ul>
        </InfoBubble>
      </div>
      {shownGaps(sync.gaps).length > 0 && (
        <div className="inventory-sync-gaps">
          <p className="inventory-sync-gaps-title">Not synced</p>
          <ul>
            {shownGaps(sync.gaps).map((gap) => (
              <li key={`${gap.characterId}:${gap.bossKey}`}>{gapLine(gap)}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
