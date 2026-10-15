"use client";

import { useState } from "react";

import { apiFetch } from "@/lib/api";
import { put } from "@/lib/cache";
import { useRowWrites } from "@/lib/use-row-writes";
import type { Party } from "@/types/party";

const PARTIES_KEY = "/api/parties";

/**
 * Answering for a night's runs: ticking a boss off, and keeping a run you have written to in the
 * order. Run Order and the home screen's Solo Run Order both draw a night through this.
 *
 * The tick is the same boss_clear row Party View's boss row writes and a planner capture
 * overwrites, so ticking a boss here and ticking it there are one answer rather than two.
 */
export function useNightClears(
  getToken: () => Promise<string | null>,
  onParties: (parties: Party[]) => void,
) {
  // Per row, so ticking one boss does not dim every other row's controls. See lib/use-row-writes.ts.
  const { isSaving, write } = useRowWrites();
  // Every config written to this sitting. They stay in the night rather than dropping out of the
  // filter under the plan somebody is reading. See stillToRun.
  //
  // ANY write, not just the tick. Logging a drop clears the boss too (a drop is evidence of a
  // night, see addLoot), so pinning on the tick alone took the run off the plan the moment the
  // first drop landed, closing the picker on a boss that had three more things to log.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());

  /** Pins a config for the sitting. Called BEFORE the write: see toggleClear. */
  function keepInNight(partyId: string) {
    setAnswered((current) => (current.has(partyId) ? current : new Set(current).add(partyId)));
  }

  /** The list again, after a write, so what is on screen is the server's answer and not ours. */
  async function refetchParties() {
    const refreshed = await apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, getToken);
    onParties(refreshed);
    put(PARTIES_KEY, refreshed);
  }

  /** Ticks a run off, or un-ticks it. */
  async function toggleClear(party: Party, cleared: boolean) {
    // Marked before the write, not after: the row has to stay in the night whether the tick lands
    // or not, or a failed save would take the run off the plan on its way to saying it failed.
    keepInNight(party.id);
    try {
      await write(party.id, async () => {
        await apiFetch<Party>(
          `${PARTIES_KEY}/${party.id}/clear`,
          { method: "PUT", body: JSON.stringify({ cleared }) },
          getToken,
        );
        await refetchParties();
      });
    } catch {
      // Leaving the old state up beats showing a tick that did not save.
    }
  }

  return { answered, keepInNight, isSaving, write, toggleClear };
}
