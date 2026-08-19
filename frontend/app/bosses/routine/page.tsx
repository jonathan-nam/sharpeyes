"use client";

import { PageSwap } from "@/components/page-swap";
import { useAuth } from "@/lib/use-auth";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { BossRoutineEditor } from "@/components/boss-routine-editor";
import { CharacterPicker } from "@/components/character-picker";
import { ApiError, apiFetch } from "@/lib/api";
import { nextSkips } from "@/lib/boss-clears";
import { peek, put } from "@/lib/cache";
import { preloadBossArt } from "@/lib/preload-boss-art";
import { useRowWrites } from "@/lib/use-row-writes";
import type { Boss, BossClearsView } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { Party, SoloDifficultyBody } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

const BOSSES_KEY = "/api/bosses";
const CLEARS_KEY = "/api/bosses/clears";
const CHARACTERS_KEY = "/api/characters";
// Solo pools included: they are where the mode of a boss run alone is kept, and this page is where
// it is said. They are still not parties, and the lock below leaves them out. See partiesFor.
const PARTIES_KEY = "/api/parties?solo=include";
const DROPS_KEY = "/api/bosses/drops";
const ROUTINE_KEY = "/api/bosses/routine";
const SOLO_KEY = "/api/parties/solo";

// Which bosses each character runs, one character at a time.
//
// Its own page, and not a mode on the matrix. The matrix answers "what is left this week", which is
// a question about a period; this answers "what does this character run at all", which is not, and
// putting both on one grid meant a click whose meaning depended on state you could not see.
export default function BossRoutinePage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken } = useAuth();

  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [characters, setCharacters] = useState<Character[]>(
    peek<Character[]>(CHARACTERS_KEY) ?? [],
  );
  const [parties, setParties] = useState<Party[]>(peek<Party[]>(PARTIES_KEY) ?? []);
  const [dropTables, setDropTables] = useState<DropTables>(peek<DropTables>(DROPS_KEY) ?? {});
  const [view, setView] = useState<BossClearsView | null>(peek<BossClearsView>(CLEARS_KEY) ?? null);
  const [state, setState] = useState<LoadState>("loading");
  const [selected, setSelected] = useState<string | null>(null);
  // Per box, so ticking one boss does not grey out the rest of the catalog with it. One write at a
  // time still, which this page needs most: it sends the whole set. See lib/use-row-writes.ts.
  const { isSaving, write } = useRowWrites();
  // The set this page last ASKED for, which is not always the set on screen. A second tick queued
  // behind the first has to build on what the first sent, or it would undo it. Null means the
  // server's answer is the truth again: nothing outstanding, a refusal, or a different character.
  const asked = useRef<Set<string> | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // One token for the whole burst, as the matrix page does: getToken() can round-trip to auth
    // and that cost is paid before every request goes out.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken),
          apiFetch<BossClearsView>(CLEARS_KEY, { method: "GET" }, withToken),
          apiFetch<DropTables>(DROPS_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([bossResult, characterResult, partyResult, viewResult, dropResult]) => {
        setBosses(bossResult);
        setCharacters(characterResult);
        setParties(partyResult);
        setView(viewResult);
        setDropTables(dropResult);
        put(BOSSES_KEY, bossResult);
        put(CHARACTERS_KEY, characterResult);
        put(PARTIES_KEY, partyResult);
        put(CLEARS_KEY, viewResult);
        put(DROPS_KEY, dropResult);
        // Open on the first character rather than on a prompt to choose one, like Edit parties.
        setSelected((current) => current ?? characterResult[0]?.id ?? null);
        setState("loaded");
      })
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const skipped = new Set(selected ? (view?.skipsByCharacter?.[selected] ?? []) : []);

  /**
   * Saves the whole routine, not the one box that changed.
   *
   * The set is what the server stores, so sending it entire keeps "unticked" meaning the same thing
   * on both sides. It also means a save that fails leaves nothing half-applied: the refusal below
   * puts the box back rather than leaving the page claiming something that was never written.
   */
  async function toggle(bossKey: string, runs: boolean) {
    if (!selected) return;
    const next = nextSkips(asked.current, skipped, bossKey, runs);
    asked.current = next;

    setError(null);
    try {
      await write(bossKey, async () => {
        const result = await apiFetch<BossClearsView>(
          ROUTINE_KEY,
          {
            method: "PUT",
            body: JSON.stringify({ characterId: selected, skippedBossKeys: Array.from(next) }),
          },
          getToken,
        );
        setView(result);
        put(CLEARS_KEY, result);
      });
    } catch (e) {
      // Back to the server's set: what we asked for is not what it holds, and building the next
      // tick on it would send a set nobody has agreed to.
      asked.current = null;
      setError(e instanceof ApiError ? e.body : "Couldn't save that.");
    }
  }

  /**
   * Records which mode this character runs a boss at alone, and refetches nothing else.
   *
   * The answer is the config as written, which is the pool this may have just opened. Merged by id
   * rather than by refetching the list: the tick above sends the whole routine, and a list arriving
   * from here would be one more thing that could land on top of it.
   */
  async function setDifficulty(bossKey: string, difficulty: string | null) {
    if (!selected) return;
    const body: SoloDifficultyBody = { characterId: selected, bossKey, difficulty };

    setError(null);
    try {
      await write(bossKey, async () => {
        const saved = await apiFetch<Party>(
          SOLO_KEY,
          { method: "PUT", body: JSON.stringify(body) },
          getToken,
        );
        setParties((current) => {
          const next = current.filter((p) => p.id !== saved.id).concat(saved);
          put(PARTIES_KEY, next);
          return next;
        });
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.body : "Couldn't save that.");
    }
  }

  const character = characters.find((c) => c.id === selected) ?? null;
  // A party config for this character and boss already says they run it, so the box is locked
  // rather than refused after the fact. See BossRoutineEditor.
  //
  // Solo pools are not that claim, and are excluded: one is a pool holding what fell on a boss run
  // alone, and locking a row over it would leave nothing to "remove first". Same line setBossRoutine
  // draws on the server.
  const lockedBossKeys = new Set(
    parties.filter((p) => p.characterId === selected && !p.solo).map((p) => p.bossKey),
  );
  const soloDifficulty = new Map(
    parties
      .filter((p) => p.characterId === selected && p.solo)
      .map((p) => [p.bossKey, p.difficulty]),
  );

  return (
    <main className="page">
      <p className="loot-back">
        <Link href="/bosses">&larr; Individual View</Link>
      </p>
      <h1 className="page-title">Who runs what</h1>

      {state === "error" && <p>Couldn&apos;t load your bosses.</p>}
      <PageSwap
        waiting={state === "loading"}
        placeholder={<p className="party-hint">Loading...</p>}
      >
        {state === "loaded" && (
          <>
            {characters.length === 0 ? (
              <p className="finder-empty">Add a character on the Inventory page first.</p>
            ) : (
              <>
                <CharacterPicker
                  characters={characters}
                  selectedId={selected}
                  onSelect={(id) => {
                    setSelected(id);
                    asked.current = null;
                    setError(null);
                  }}
                />

                {error && <p className="routine-error">{error}</p>}

                {character && (
                  <BossRoutineEditor
                    characterName={character.name}
                    bosses={bosses}
                    dropTables={dropTables}
                    skipped={skipped}
                    lockedBossKeys={lockedBossKeys}
                    soloDifficulty={soloDifficulty}
                    isSaving={isSaving}
                    onToggle={toggle}
                    onDifficulty={setDifficulty}
                  />
                )}
              </>
            )}
          </>
        )}
      </PageSwap>
    </main>
  );
}
