"use client";

import { useAuth } from "@/lib/use-auth";
import { useEffect, useState } from "react";
import { AddCharacter } from "@/components/add-character";
import { CharacterRow } from "@/components/character-row";
import { PageSwap } from "@/components/page-swap";
import { ApiError, apiFetch } from "@/lib/api";
import { invalidate, peek, put } from "@/lib/cache";
import { groupByWorld } from "@/lib/character-groups";
import { SETTINGS_KEY, setAccountSettings, useAccountSettings } from "@/lib/use-account-settings";
import { otherWorld, worldLabel } from "@/lib/world";
import type { Character } from "@/types/character";
import type { Settings } from "@/types/settings";

const CHARACTERS_KEY = "/api/characters";

// Your characters, and everything you can do to one.
//
// Adding, ordering, refreshing and deleting. Which world a character is in is NOT among them: it
// comes from the ranking lookup, and refreshing is how a wrong one is corrected. The inventory
// carousel used to carry all this, which meant the strip you pick a character from was also the
// strip you managed them in. This is that page, and the carousel is now only a picker.

export default function CharactersPage() {
  const { getToken } = useAuth();
  const settings = useAccountSettings();

  const seeded = peek<Character[]>(CHARACTERS_KEY);
  const [characters, setCharacters] = useState<Character[]>(seeded ?? []);
  const [loaded, setLoaded] = useState(Boolean(seeded));
  const [failed, setFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A character the lookup put in the other world, on being added or refreshed. Not an error: it
  // is the app learning where a character actually is, and the one thing that would otherwise
  // happen with nothing on screen to show for it.
  const [elsewhere, setElsewhere] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);

  useEffect(() => {
    apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, getToken)
      .then((result) => {
        setCharacters(result);
        put(CHARACTERS_KEY, result);
        setLoaded(true);
      })
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Shows the change, then persists it, and puts it back if the server refuses.
   *
   * Optimistic because the alternative flickered, and nothing on the page is disabled while it is
   * in flight: .tile-move and .party-* both dim when disabled, so a page-wide busy flag made every
   * other row flash on a click that changed one of them.
   *
   * The caches are dropped rather than reasoned about. Only reordering goes through here now, and
   * that alone would not need it, but the cost is one request against a class of bug that is
   * silent: a screen drawn from a list this page has already replaced.
   */
  async function persist(apply: (list: Character[]) => Character[], save: () => Promise<unknown>) {
    const before = characters;
    const shown = apply(before);
    setCharacters(shown);
    put(CHARACTERS_KEY, shown);
    setError(null);
    try {
      await save();
      invalidate("/api/parties");
      invalidate("/api/bosses");
      setAccountSettings(await apiFetch<Settings>(SETTINGS_KEY, { method: "GET" }, getToken));
    } catch (e) {
      // Back to what the server still holds. Leaving the optimistic value up would put a world on
      // screen that no party actually reads.
      setCharacters(before);
      put(CHARACTERS_KEY, before);
      setError(e instanceof ApiError ? e.body : "Couldn't save that.");
    }
  }

  // Swaps two characters in the flat list, which is what the carousel reads. The caller decides
  // WHICH two: within a world, so an arrow at the edge of a group cannot walk a character into a
  // world it does not play in.
  const move = (index: number, target: number) => {
    if (target < 0 || target >= characters.length) return;
    const next = characters.slice();
    const moved = next[index];
    const displaced = next[target];
    // Bounds already guarantee both exist; the guard is what tells the type checker so.
    if (!moved || !displaced) return;
    next[index] = displaced;
    next[target] = moved;
    return persist(
      () => next,
      () =>
        apiFetch<Character[]>(
          `${CHARACTERS_KEY}/order`,
          { method: "PUT", body: JSON.stringify({ orderedIds: next.map((c) => c.id) }) },
          getToken,
        ),
    );
  };

  // Written straight to state rather than through write(): these already hold the new roster, and
  // re-deriving it from a list this component is about to replace would fight itself.
  //
  // A character's world comes from the LOOKUP, so both adding and refreshing one can put it in a
  // world this list is not showing. Both take it off the list and say where it went, because a row
  // that disappears on the next load is worse than a line naming the world it is in.
  const placed = (character: Character) => {
    if (character.worldType === settings?.worldType) return true;
    setElsewhere(
      `${character.name} is in ${character.worldName ?? worldLabel(character.worldType)}.`,
    );
    return false;
  };
  const added = (character: Character) => {
    if (placed(character)) setCharacters((prev) => [...prev, character]);
    invalidate("/api/");
  };
  // A refresh is the only thing that can now move a character between worlds, so it is the only
  // place a row can leave this list without being deleted.
  const updated = (character: Character) => {
    if (placed(character)) {
      setCharacters((prev) => prev.map((c) => (c.id === character.id ? character : c)));
      return;
    }
    setCharacters((prev) => prev.filter((c) => c.id !== character.id));
    invalidate("/api/");
  };
  const deleted = (id: string) => {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    invalidate("/api/");
  };

  const groups = groupByWorld(characters);
  // Characters added before the world was looked up, or whose lookup found nothing. There is no
  // way to type a world in, so this is the only thing standing between them and a group.
  const unplaced = characters.filter((c) => c.worldName === null);
  const plural = unplaced.length === 1 ? "" : "s";

  /**
   * Asks the game where each unplaced character is, one at a time.
   *
   * The same refresh the row's own button does, so there is one path that can set a world rather
   * than a bulk one that could drift from it. Sequential rather than at once: each lookup already
   * fans out across every world, and the rows filling in one by one is the progress report.
   *
   * A character that turns out to be in the other world leaves the list as it lands, which
   * `updated` already says out loud.
   */
  async function findWorlds() {
    if (finding) return;
    setFinding(true);
    setError(null);
    try {
      for (const character of unplaced) {
        updated(
          await apiFetch<Character>(
            `${CHARACTERS_KEY}/${character.id}/refresh`,
            { method: "POST" },
            getToken,
          ),
        );
      }
      invalidate("/api/");
    } catch (e) {
      // Whatever was found before the failure is kept: those characters really are placed now.
      setError(e instanceof ApiError ? e.body : "Couldn't look those up.");
    } finally {
      setFinding(false);
    }
  }

  return (
    // Waiting is `!loaded && !failed`, not `!loaded`: a page that failed has its answer and is
    // done waiting, and holding the class would fade the error in a second time.
    <main className="page">
      <div className="settings-section-head">
        <h1 className="page-title">Characters</h1>
        {/* Only while there is something to look up, so it takes itself off the page. Every
            character added from here on arrives with a world already. */}
        {unplaced.length > 0 && (
          <button type="button" className="party-cancel" onClick={findWorlds} disabled={finding}>
            {finding ? "Looking up..." : `Look up ${unplaced.length} world${plural}`}
          </button>
        )}
      </div>

      {failed && !loaded && <p>Couldn&apos;t load your characters.</p>}
      <PageSwap waiting={!loaded && !failed} placeholder={<p className="party-hint">Loading...</p>}>
        {loaded && (
          <>
            {groups.map((group) => (
              <section className="character-group" key={group.world ?? "unplaced"}>
                <h2 className="character-world">{group.world ?? "World not looked up"}</h2>
                <ul className="character-list">
                  {group.characters.map((character) => {
                    // Against the group, not the page: an arrow at a group's edge has nowhere to go,
                    // because the character on the other side of it plays somewhere else.
                    const within = group.characters.indexOf(character);
                    const index = characters.indexOf(character);
                    const neighbour = (step: -1 | 1) =>
                      characters.indexOf(group.characters[within + step]!);
                    return (
                      <CharacterRow
                        key={character.id}
                        character={character}
                        onUpdated={updated}
                        onDeleted={deleted}
                        onMove={(direction) => move(index, neighbour(direction))}
                        canMoveUp={within > 0}
                        canMoveDown={within < group.characters.length - 1}
                      />
                    );
                  })}
                </ul>
              </section>
            ))}

            <AddCharacter onAdded={added} />

            {error && <p className="routine-error">{error}</p>}

            {elsewhere && <p className="party-hint">{elsewhere}</p>}

            {/* The list is one world's. This is the rest of the account, and it is said because an
              empty page in the wrong world looks exactly like an account with no characters. */}
            {settings && settings.otherWorldCharacters > 0 && (
              <p className="party-hint">
                {settings.otherWorldCharacters}{" "}
                {settings.otherWorldCharacters === 1 ? "character" : "characters"} in{" "}
                {worldLabel(otherWorld(settings.worldType))}.
              </p>
            )}
          </>
        )}
      </PageSwap>
    </main>
  );
}
