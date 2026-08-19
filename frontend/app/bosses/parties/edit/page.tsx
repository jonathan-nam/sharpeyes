"use client";

import { PageSwap } from "@/components/page-swap";
import { useAuth } from "@/lib/use-auth";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CharacterPicker } from "@/components/character-picker";
import { PartyConfigEditor } from "@/components/party-config-editor";
import { ApiError, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import { preloadBossArt } from "@/lib/preload-boss-art";
import { useRowWrites } from "@/lib/use-row-writes";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { Party, Person, SavePartyBody, SetPartySkipBody } from "@/types/party";

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

  const { getToken } = useAuth();

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
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  async function save(body: SavePartyBody, partyId?: string) {
    setError(null);
    try {
      await write(partyId ?? ADD_PARTY, async () => {
        await apiFetch<Party>(
          partyId ? `${PARTIES_KEY}/${partyId}` : PARTIES_KEY,
          { method: partyId ? "PUT" : "POST", body: JSON.stringify(body) },
          getToken,
        );
        // Refetched rather than spliced in: the server decides seat ids and which seat is yours.
        await loadParties();
      });
    } catch (e) {
      // The backend refuses with the reason in the body (see validateNewParty). Showing it beats
      // "something went wrong" for the one thing the user can actually fix.
      setError(e instanceof ApiError ? e.body : "Couldn't save that party.");
    }
  }

  /**
   * Puts a boss back on the period Party View took it off.
   *
   * Only this direction is offered here. Taking one off is a decision about the week you are looking
   * at, which is Party View's screen; this page is where you come to undo it, because that is where
   * the row still is.
   */
  async function putBack(party: Party) {
    setError(null);
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
      setError(e instanceof ApiError ? e.body : "Couldn't put that boss back.");
    }
  }

  async function remove(party: Party) {
    setError(null);
    try {
      await write(party.id, async () => {
        await apiFetch<void>(`${PARTIES_KEY}/${party.id}`, { method: "DELETE" }, getToken);
        await loadParties();
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.body : "Couldn't remove that party.");
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

  return (
    <main className="page">
      <p className="loot-back">
        <Link href="/bosses/parties">&larr; Party View</Link>
      </p>
      <h1 className="page-title">Edit parties</h1>

      {/* People is not in the hamburger any more: naming whose character is which is part of
          setting a party up, so it lives here, where you already are when you need it. */}
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
                    setError(null);
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
                    isSaving={isSaving}
                    adding={isSaving(ADD_PARTY)}
                    error={error}
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
