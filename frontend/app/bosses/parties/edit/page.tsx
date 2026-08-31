"use client";

import { PageSwap } from "@/components/page-swap";
import { useAuth } from "@/lib/use-auth";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CharacterPicker } from "@/components/character-picker";
import { PartyConfigEditor } from "@/components/party-config-editor";
import { ApiError, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { rosterConflictOf } from "@/lib/roster-conflict";
import { preloadBossArt } from "@/lib/preload-boss-art";
import { spriteByName } from "@/lib/sprite-by-name";
import { useRowWrites } from "@/lib/use-row-writes";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { Party, Person, RosterMove, SavePartyBody, SetPartySkipBody } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

const PARTIES_KEY = "/api/parties";
const BOSSES_KEY = "/api/bosses";
const CHARACTERS_KEY = "/api/characters";
const PEOPLE_KEY = "/api/people";
// For the stack counts beside an uneven split, so "4 and 2" can say what it is four and two OF.
const DROPS_KEY = "/api/bosses/drops";
// Rows are keyed by their config's id while they save. Adding one is not a row yet, so it takes a
// name of its own. See lib/use-row-writes.ts.
const ADD_PARTY = "add-party";

// Editing, one character at a time. The Parties page answers "what are my parties"; this answers
// "change them", and it does it the way the question is asked: pick a character, then say who they
// run each boss with.
export default function EditPartiesPage() {
  // Before anything is fetched: see lib/preload-boss-art.ts.
  preloadBossArt();

  const { getToken, isLoaded } = useAuth();

  const [parties, setParties] = useState<Party[]>(peek<Party[]>(PARTIES_KEY) ?? []);
  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [characters, setCharacters] = useState<Character[]>(
    peek<Character[]>(CHARACTERS_KEY) ?? [],
  );
  const [people, setPeople] = useState<Person[]>(peek<Person[]>(PEOPLE_KEY) ?? []);
  const [dropTables, setDropTables] = useState<DropTables>(peek<DropTables>(DROPS_KEY) ?? {});
  const [state, setState] = useState<LoadState>("loading");
  const [selected, setSelected] = useState<string | null>(null);
  // Per config, so saving one row does not grey out every other row's buttons. One write at a time
  // still, because each one refetches the list. See lib/use-row-writes.ts.
  const { isSaving, write } = useRowWrites();
  // Keyed the same way the in-flight writes are, so a refusal reaches the row it is about. Why it
  // has to be per row: see errorFor in components/party-config-editor.tsx.
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const errorFor = (key: string) => (failure?.key === key ? failure.message : null);
  const failed = (key: string, e: unknown, fallback: string) =>
    setFailure({
      // A 409's body is the conflict, as JSON, not a sentence. It only reaches here when the shape
      // was unreadable, and putting that on screen would be worse than saying nothing useful.
      key,
      message: e instanceof ApiError && e.status !== 409 ? e.body : fallback,
    });

  // The one refusal that is a question rather than a dead end: somebody in the roster is in another
  // party for this boss. Held with the save that raised it, because answering means sending that
  // same save again with the parties to take them out of. See lib/roster-conflict.ts.
  const [pending, setPending] = useState<{
    key: string;
    moves: RosterMove[];
    body: SavePartyBody;
    partyId?: string;
  } | null>(null);

  async function loadParties(token?: string | null) {
    const result = await apiFetch<Party[]>(
      PARTIES_KEY,
      { method: "GET" },
      token !== undefined ? () => Promise.resolve(token) : getToken,
    );
    setParties(result);
    put(PARTIES_KEY, result);
  }

  useEffect(() => {
    // Not before Clerk answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          loadParties(token),
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          apiFetch<Person[]>(PEOPLE_KEY, { method: "GET" }, withToken),
          apiFetch<DropTables>(DROPS_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([, bossResult, characterResult, peopleResult, dropResult]) => {
        setBosses(bossResult);
        setCharacters(characterResult);
        setPeople(peopleResult);
        setDropTables(dropResult);
        put(BOSSES_KEY, bossResult);
        put(CHARACTERS_KEY, characterResult);
        put(PEOPLE_KEY, peopleResult);
        put(DROPS_KEY, dropResult);
        // Open on the first character rather than on a prompt to choose one.
        setSelected((current) => current ?? characterResult[0]?.id ?? null);
        setState("loaded");
      })
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  async function save(body: SavePartyBody, partyId?: string) {
    const key = partyId ?? ADD_PARTY;
    setFailure(null);
    setPending(null);
    try {
      await write(key, async () => {
        await apiFetch<Party>(
          partyId ? `${PARTIES_KEY}/${partyId}` : PARTIES_KEY,
          { method: partyId ? "PUT" : "POST", body: JSON.stringify(body) },
          getToken,
        );
        // Refetched rather than spliced in: the server decides seat ids and which seat is yours.
        await loadParties();
      });
    } catch (e) {
      const conflict = rosterConflictOf(e);
      if (conflict) {
        setPending({ key, moves: conflict.moves, body, partyId });
        return;
      }
      // The backend refuses with the reason in the body (see validateNewParty). Showing it beats
      // "something went wrong" for the one thing the user can actually fix.
      failed(key, e, "Couldn't save that party.");
    }
  }

  /**
   * Runs the move the last save was refused for.
   *
   * The same body again, with the parties it has to take people out of. Both halves are one
   * transaction on the server, so this cannot half happen. See applyRoster.
   */
  function confirmMove() {
    if (!pending) return;
    const { body, partyId, moves } = pending;
    void save({ ...body, releaseFrom: moves.map((m) => m.partyId) }, partyId);
  }

  /**
   * Puts a boss back on the period Party View took it off.
   *
   * Only this direction is offered here. Taking one off is a decision about the week you are looking
   * at, which is Party View's screen; this page is where you come to undo it, because that is where
   * the row still is.
   */
  async function putBack(party: Party) {
    setFailure(null);
    setPending(null);
    try {
      await write(party.id, async () => {
        await apiFetch<Party>(
          `${PARTIES_KEY}/${party.id}/skip`,
          { method: "PUT", body: JSON.stringify({ skipped: false } satisfies SetPartySkipBody) },
          getToken,
        );
        await loadParties();
      });
    } catch (e) {
      failed(party.id, e, "Couldn't put that boss back.");
    }
  }

  async function remove(party: Party) {
    setFailure(null);
    setPending(null);
    try {
      await write(party.id, async () => {
        await apiFetch<void>(`${PARTIES_KEY}/${party.id}`, { method: "DELETE" }, getToken);
        await loadParties();
      });
    } catch (e) {
      failed(party.id, e, "Couldn't remove that party.");
    }
  }

  const character = characters.find((c) => c.id === selected) ?? null;
  // Every character named anywhere: your roster, the people list, and whoever is already in a
  // party. Typing a name the app already knows should not mean typing it differently.
  const knownCharacters = Array.from(
    new Set([
      ...characters.map((c) => c.name),
      ...people.flatMap((p) => p.characters),
      ...parties.flatMap((p) => p.members.map((m) => m.name)),
    ]),
  ).sort();
  // The same three sources, minus the people list, which holds names and no art. Built once for
  // the page rather than per row: a character in four parties is one lookup.
  const sprites = spriteByName(characters, parties);

  return (
    <main className="page">
      <p className="loot-back">
        <Link href="/bosses/parties">&larr; Party View</Link>
      </p>
      <h1 className="page-title">Edit parties</h1>

      {/* People is not in the hamburger any more: naming whose character is which is part of
          setting a party up, so it is reached from here, where you already are when you need it. */}
      <div className="party-toolbar">
        <span className="party-toolbar-links">
          <Link className="party-cancel" href="/bosses/people">
            People
          </Link>
        </span>
      </div>

      {state === "error" && <p>Couldn&apos;t load your parties.</p>}
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
                    setFailure(null);
                    setPending(null);
                  }}
                />

                {character && (
                  <PartyConfigEditor
                    characterId={character.id}
                    characterName={character.name}
                    parties={parties.filter((p) => p.characterId === character.id)}
                    bosses={bosses}
                    dropTables={dropTables}
                    knownCharacters={knownCharacters}
                    spriteFor={(name) => sprites.get(name) ?? null}
                    isSaving={isSaving}
                    adding={isSaving(ADD_PARTY)}
                    errorFor={errorFor}
                    addError={errorFor(ADD_PARTY)}
                    movesFor={(id) => (pending?.key === id ? pending.moves : null)}
                    addMoves={pending?.key === ADD_PARTY ? pending.moves : null}
                    onConfirmMove={confirmMove}
                    onCancelMove={() => setPending(null)}
                    onSave={save}
                    onDelete={remove}
                    onPutBack={putBack}
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
