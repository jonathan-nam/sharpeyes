"use client";

import { useEffect, useState } from "react";
import { SettingsHead } from "@/components/settings-head";
import { apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { VESTIGE } from "@/lib/settlement-view";
import { useAuth } from "@/lib/use-auth";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { Party, SeatedParty, SetAutoVestigesBody } from "@/types/party";

const PARTIES_KEY = "/api/parties";
const SEATED_KEY = "/api/parties/seated";
const BOSSES_KEY = "/api/bosses";
const DROPS_KEY = "/api/bosses/drops";

/** Yours and the ones you sit in, that drop coupons in their world, by boss. */
function shown(
  parties: Party[],
  seated: SeatedParty[],
  drops: DropTables,
  bosses: Boss[],
): Party[] {
  const byId = new Map<string, Party>();
  for (const party of [...parties, ...seated.map((row) => row.party)]) byId.set(party.id, party);
  const order = new Map(bosses.map((boss, i) => [boss.bossKey, i]));
  return [...byId.values()]
    .filter((party) => !party.solo && !party.retired)
    .filter((party) =>
      drops[party.bossKey]?.some(
        (drop) => drop.dropKey === VESTIGE && drop.pieces?.[party.worldType],
      ),
    )
    .sort((a, b) => (order.get(a.bossKey) ?? 0) - (order.get(b.bossKey) ?? 0));
}

export default function PartySettingsPage() {
  const { getToken, isLoaded } = useAuth();
  const [parties, setParties] = useState<Party[]>(peek<Party[]>(PARTIES_KEY) ?? []);
  const [seated, setSeated] = useState<SeatedParty[]>(peek<SeatedParty[]>(SEATED_KEY) ?? []);
  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [drops, setDrops] = useState<DropTables | null>(peek<DropTables>(DROPS_KEY) ?? null);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    // Not before auth answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    Promise.all([
      apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, getToken),
      apiFetch<SeatedParty[]>(SEATED_KEY, { method: "GET" }, getToken),
      apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, getToken),
      apiFetch<DropTables>(DROPS_KEY, { method: "GET" }, getToken),
    ])
      .then(([partyResult, seatedResult, bossResult, dropResult]) => {
        const present = seatedResult.filter((row) => row.party);
        setParties(partyResult);
        setSeated(present);
        setBosses(bossResult);
        setDrops(dropResult);
        put(PARTIES_KEY, partyResult);
        put(SEATED_KEY, present);
        put(BOSSES_KEY, bossResult);
        put(DROPS_KEY, dropResult);
      })
      .catch(() => {
        /* keep what we have */
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  async function save(party: Party, enabled: boolean) {
    setSaving(party.id);
    try {
      const body: SetAutoVestigesBody = { enabled };
      const result = await apiFetch<Party>(
        `/api/parties/${party.id}/auto-vestiges`,
        { method: "PUT", body: JSON.stringify(body) },
        getToken,
      );
      const nextParties = parties.map((p) => (p.id === result.id ? result : p));
      const nextSeated = seated.map((row) =>
        row.party.id === result.id ? { ...row, party: result } : row,
      );
      setParties(nextParties);
      setSeated(nextSeated);
      put(PARTIES_KEY, nextParties);
      put(SEATED_KEY, nextSeated);
    } catch {
      // The box stays as the server last said, which is what `checked` reads.
    } finally {
      setSaving(null);
    }
  }

  const bossName = new Map(bosses.map((boss) => [boss.bossKey, boss.name]));
  const rows = drops ? shown(parties, seated, drops, bosses) : [];

  return (
    <main className="page">
      <SettingsHead current="parties" />
      {drops && (
        <section className="character-group social-section">
          <h2 className="character-world">Auto Add Vestiges on Boss Clear</h2>
          {rows.length === 0 && <p className="party-hint">No parties drop vestiges.</p>}
          {rows.map((party) => (
            <label key={party.id} className="night-toggle">
              <input
                type="checkbox"
                // Absent on a payload cached from before the field.
                checked={party.autoAddVestiges ?? false}
                disabled={saving === party.id}
                onChange={(e) => void save(party, e.target.checked)}
              />
              <span>
                {bossName.get(party.bossKey) ?? party.bossKey}
                {" · "}
                {party.seats.find((seat) => seat.characterId === party.characterId)?.name ??
                  party.slug.split("/")[0]}
              </span>
            </label>
          ))}
        </section>
      )}
    </main>
  );
}
