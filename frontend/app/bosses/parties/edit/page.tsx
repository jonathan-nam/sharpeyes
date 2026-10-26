"use client";

import { ButtonLink } from "@/components/button";
import { PageSwap } from "@/components/page-swap";
import { useAuth } from "@/lib/use-auth";
import Link from "next/link";
import { OtherWorld } from "@/components/other-world";
import { useEffect, useState } from "react";
import { CharacterPicker } from "@/components/character-picker";
import { PartyConfigEditor } from "@/components/party-config-editor";
import { apiFetch, duplicatePartyIn, failureText } from "@/lib/api";
import { announceInvites } from "@/lib/invite-notice";
import { DuplicateParty } from "@/components/duplicate-party";
import { peek, put } from "@/lib/cache";
import { reportDataReady } from "@/lib/rum";
import { preloadBossArt } from "@/lib/preload-boss-art";
import { spriteByName } from "@/lib/sprite-by-name";
import { useRowWrites } from "@/lib/use-row-writes";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { Party, Person, SavePartyBody, SeatedParty } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

const PARTIES_KEY = "/api/parties";
const SEATED_KEY = "/api/parties/seated";
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
  const [seated, setSeated] = useState<SeatedParty[]>(peek<SeatedParty[]>(SEATED_KEY) ?? []);
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

  // Yours and the ones you sit in, which this page edits alike.
  async function loadParties(token?: string | null) {
    const auth = token !== undefined ? () => Promise.resolve(token) : getToken;
    const [result, seatedResult] = await Promise.all([
      apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, auth),
      apiFetch<SeatedParty[]>(SEATED_KEY, { method: "GET" }, auth),
    ]);
    setParties(result);
    put(PARTIES_KEY, result);
    const present = seatedResult.filter((row) => row.party);
    setSeated(present);
    put(SEATED_KEY, present);
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
        reportDataReady();
      })
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  // A new party somebody you are linked to already keeps with you, with the body that hit it.
  const [duplicate, setDuplicate] = useState<{
    refusal: string;
    partyId: string;
    body: SavePartyBody;
  } | null>(null);

  async function save(body: SavePartyBody, partyId?: string) {
    setError(null);
    setDuplicate(null);
    try {
      await write(partyId ?? ADD_PARTY, async () => {
        const saved = await apiFetch<Party>(
          partyId ? `${PARTIES_KEY}/${partyId}` : PARTIES_KEY,
          { method: partyId ? "PUT" : "POST", body: JSON.stringify(body) },
          getToken,
        );
        announceInvites(saved);
        // Refetched rather than spliced in: the server decides seat ids and which seat is yours.
        await loadParties();
      });
    } catch (e) {
      const found = duplicatePartyIn(e);
      if (found) {
        setDuplicate({ ...found, body });
        return;
      }
      // The backend refuses with the reason in the body (see validateNewParty). Showing it beats
      // "something went wrong" for the one thing the user can actually fix.
      setError(failureText(e, "Couldn't save that party. Try again."));
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
      setError(failureText(e, "Couldn't remove that party. Try again."));
    }
  }

  const character = characters.find((c) => c.id === selected) ?? null;
  const everyParty = [...parties, ...seated.map((row) => row.party)];
  // Every character named anywhere: your roster, the people list, and whoever is already in a
  // party. Typing a name the app already knows should not mean typing it differently.
  const knownCharacters = Array.from(
    new Set([
      ...characters.map((c) => c.name),
      ...people.flatMap((p) => p.characters),
      ...everyParty.flatMap((p) => p.members.map((m) => m.name)),
    ]),
  ).sort();
  // The same three sources, minus the people list, which holds names and no art. Built once for
  // the page rather than per row: a character in four parties is one lookup.
  const sprites = spriteByName(characters, everyParty);

  return (
    <main className="page">
      {/* People is not in the hamburger any more: naming whose character is which is part of
          setting a party up, so it is reached from here. It sits where Party View carries its way
          here, so the two pages point at each other from the same corner. */}
      <div className="page-head">
        <p className="loot-back">
          <Link href="/bosses/parties">&larr; Party View</Link>
        </p>
        <span className="page-head-links">
          <ButtonLink variant="secondary" href="/bosses/people">
            Edit People
          </ButtonLink>
        </span>
      </div>
      <h1 className="page-title">Edit Parties</h1>

      {state === "error" && <p>Couldn&apos;t load your parties. Reload to try again.</p>}
      <PageSwap
        waiting={state === "loading"}
        placeholder={<p className="party-hint">Loading...</p>}
      >
        {state === "loaded" && (
          <>
            {characters.length === 0 ? (
              <>
                <p className="finder-empty">
                  No characters yet. <Link href="/characters">Add one</Link> first.
                </p>
                {/* This list is one world's, so "no characters" can mean they are all in the other
                    one. See OtherWorld. */}
                <OtherWorld />
              </>
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
                    joined={seated
                      .filter((row) => row.yourCharacterId === character.id)
                      .map((row) => row.party)}
                    bosses={bosses}
                    dropTables={dropTables}
                    knownCharacters={knownCharacters}
                    spriteFor={(name) => sprites.get(name) ?? null}
                    isSaving={isSaving}
                    adding={isSaving(ADD_PARTY)}
                    error={error}
                    notice={
                      duplicate && (
                        <DuplicateParty
                          refusal={duplicate.refusal}
                          partyId={duplicate.partyId}
                          busy={isSaving(ADD_PARTY)}
                          onAddAnyway={() => void save({ ...duplicate.body, separate: true })}
                        />
                      )
                    }
                    onSave={save}
                    onDelete={remove}
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
