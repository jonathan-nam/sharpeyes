"use client";

import Link from "next/link";
import { useState } from "react";
import { apiAssetUrl, failureText } from "@/lib/api";
import { formatWeekStart } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import { suggestArrangement } from "@/lib/vestige-ledger";
import type { UnansweredDrop } from "@/lib/vestige-ledger";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";
import { partyHref } from "@/lib/party-path";

// Nights nobody has said the arrangement for, and the one control that answers them.
//
// One chip per STACK, not a count per seat. A stack is what somebody bent down for, so the chips
// are the physical thing, and clicking one moves it to the next seat. The counts therefore always
// add up to the stacks that fell, which is the only rule the server enforces: an arrangement that
// does not add up looks answered and measures a debt against stacks nobody accounted for.
//
// Pre-filled with the balanced arrangement, odd stack to whoever is furthest behind, so an ordinary
// week is one button. Pre-filled, never pre-saved: the suggestion moves when an earlier week is
// edited and a stored guess would rewrite nights already settled. See suggestArrangement.

export function StackArrangement({
  drops,
  partyById,
  bossByKey,
  behind,
  iconUrl,
  busy,
  onSave,
}: {
  drops: UnansweredDrop[];
  partyById: Map<string, Party>;
  bossByKey: Map<string, Boss>;
  /** Each holder's position across what is already recorded, so the odd stack rotates. */
  behind: Map<string, number>;
  /** The coupon's own sprite, backend-relative. Null when the catalog has no art for it. */
  iconUrl: string | null;
  busy: boolean;
  onSave: (partyId: string, lootId: string, bundles: Record<string, number>) => Promise<void>;
}) {
  if (drops.length === 0) return null;
  return (
    <section className="ledger-card">
      {/* The same head as the ledger below it, because it is the same coupon. No piece total: it
          would be the sum of the numbers already on the rows underneath. */}
      <header className="ledger-head">
        {iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(iconUrl)} alt="" />
        ) : (
          <span className="loot-icon" aria-hidden="true" />
        )}
        <span className="loot-title">
          <span className="loot-name">Vestige of Erion</span>
        </span>
        <span className="ledger-tally">
          {drops.length} {drops.length === 1 ? "night" : "nights"} unanswered
        </span>
      </header>

      <ul className="ledger-queue">
        {drops.map((drop) => {
          const party = partyById.get(drop.partyId);
          if (!party) return null;
          return (
            <DropArrangement
              key={drop.lootId}
              drop={drop}
              party={party}
              boss={bossByKey.get(drop.bossKey ?? "")}
              behind={behind}
              busy={busy}
              onSave={onSave}
            />
          );
        })}
      </ul>
    </section>
  );
}

function DropArrangement({
  drop,
  party,
  boss,
  behind,
  busy,
  onSave,
}: {
  drop: UnansweredDrop;
  party: Party;
  boss: Boss | undefined;
  behind: Map<string, number>;
  busy: boolean;
  onSave: (partyId: string, lootId: string, bundles: Record<string, number>) => Promise<void>;
}) {
  // The week's own roster, off the drop. The party's would be the week the page asked for, which
  // cannot offer a stack to the guest who ran the night this fell on. See ranSeats.
  const seats = drop.seats;
  // One entry per stack, holding the seat that picked it up. Built from the suggestion, so the
  // ordinary case is already right and the chips only have to be touched when it was not.
  const [owners, setOwners] = useState<string[]>(() => {
    const suggested = suggestArrangement(drop.bundles, seats, behind);
    return seats.flatMap((s) => Array<string>(suggested.get(s.id) ?? 0).fill(s.id));
  });
  const [refusal, setRefusal] = useState<string | null>(null);

  const size = drop.quantity / drop.bundles;
  const nameOf = (id: string) => seats.find((s) => s.id === id)?.name ?? "?";

  function cycle(at: number) {
    setOwners((was) =>
      was.map((id, i) => {
        if (i !== at) return id;
        const next = seats.findIndex((s) => s.id === id) + 1;
        return seats[next % seats.length]!.id;
      }),
    );
  }

  async function save() {
    setRefusal(null);
    const bundles: Record<string, number> = {};
    for (const id of owners) bundles[id] = (bundles[id] ?? 0) + 1;
    try {
      await onSave(party.id, drop.lootId, bundles);
    } catch (e) {
      setRefusal(failureText(e, "That didn't save. Try again."));
    }
  }

  return (
    <li className="ledger-drop">
      <div className="ledger-drop-head">
        {/* Linked like the ledger's own rows: one boss can be run by two of your characters, and
            which party this is cannot be read off the boss name alone. */}
        <Link href={partyHref(party)} className="loot-name">
          {boss ? bossLabel(boss.name, party.difficulty) : "–"}
        </Link>
        <span className="loot-meta">
          {drop.bundles} × {size} · week of {formatWeekStart(drop.weekStart)}
        </span>
        <span className="loot-share-nets">{drop.imbalance} misplaced</span>
      </div>

      <ul className="stack-chips">
        {owners.map((id, i) => (
          // Keyed by position: the chips ARE the stacks, and two stacks held by one seat are two
          // of them rather than one that counts twice.
          <li key={i}>
            <button
              type="button"
              className="stack-chip"
              disabled={busy}
              onClick={() => cycle(i)}
              aria-label={`Stack ${i + 1} of ${drop.bundles}, picked up by ${nameOf(id)}. Change.`}
            >
              {nameOf(id)}
            </button>
          </li>
        ))}
        <li>
          <button type="button" className="party-save" disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </li>
      </ul>

      {refusal && <span className="split-error">{refusal}</span>}
    </li>
  );
}
