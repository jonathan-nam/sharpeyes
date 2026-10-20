"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { SharpEyesMark } from "@/components/sharp-eyes-mark";
import { setAccountSettings, SETTINGS_KEY } from "@/lib/use-account-settings";
import { useAuth } from "@/lib/use-auth";
import { WORLDS_IN, emblemFor } from "@/lib/world-names";
import { WORLD_TYPES, worldLabel, type WorldType } from "@/lib/world";
import type { Settings } from "@/types/settings";

/**
 * Which world the account plays in, asked once, before there is anything to be wrong about.
 *
 * users.world_type is the lens every account-wide read narrows by, and until V74 a new account held
 * INTERACTIVE without anyone having chosen it. A Heroic player was then shown Interactive drop
 * pools, piece counts joined on the wrong world, and a Sale Ledger for a world that does not trade,
 * with nothing on screen saying an assumption had been made.
 *
 * The card names the worlds it covers rather than explaining the categories. A player knows they
 * log into Kronos; whether Nexon files that under "Heroic" is our word for it, not theirs.
 */
export function WorldChoice({
  chosen = null,
  onChosen,
  embedded = false,
}: {
  /** The world already on the account, drawn as picked. Picking it again saves nothing. */
  chosen?: WorldType | null;
  /** After the choice is saved, or the one already chosen is picked again. */
  onChosen?: () => void;
  /** Inside a page that has its own heading and mark: the question becomes a subheading. */
  embedded?: boolean;
} = {}) {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState<WorldType | null>(null);
  const [failed, setFailed] = useState(false);

  async function choose(world: WorldType) {
    if (busy) return;
    if (world === chosen) {
      onChosen?.();
      return;
    }
    setBusy(world);
    setFailed(false);
    try {
      const saved = await apiFetch<Settings>(
        SETTINGS_KEY,
        { method: "PUT", body: JSON.stringify({ worldType: world }) },
        getToken,
      );
      // No reload, unlike the header toggle. That one reloads because every list on the page behind
      // it was narrowed by the world it is leaving, and this screen has no world behind it: setting
      // the store is the whole of the change, and the page it reveals fetches on mount anyway.
      setAccountSettings(saved);
      setBusy(null);
      onChosen?.();
    } catch {
      setFailed(true);
      setBusy(null);
    }
  }

  return (
    <section className={embedded ? "world-choice" : "hero world-choice"}>
      {embedded ? (
        <h2 className="welcome-step-title">Which world do you play in?</h2>
      ) : (
        <>
          <SharpEyesMark size={64} />
          <h1>Which world do you play in?</h1>
        </>
      )}
      <div className="world-choice-cards">
        {WORLD_TYPES.map((world) => (
          <button
            key={world}
            type="button"
            className={world === chosen ? "world-choice-card is-chosen" : "world-choice-card"}
            disabled={busy !== null}
            onClick={() => choose(world)}
          >
            {/* Each world's own emblem from the game's world select, beside its name. See
                scripts/build-world-emblems.mjs for where they are cut from. */}
            <span className="world-choice-worlds">
              {WORLDS_IN[world].map((name) => (
                <span key={name} className="world-choice-world">
                  <img className="world-emblem" src={emblemFor(name)} alt="" />
                  {name}
                </span>
              ))}
            </span>
            <span className="world-choice-name">{worldLabel(world)}</span>
          </button>
        ))}
      </div>
      {failed && <p className="routine-error">Couldn&apos;t save that. Try again.</p>}
    </section>
  );
}
