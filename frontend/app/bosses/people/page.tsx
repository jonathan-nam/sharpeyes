"use client";

import { PageSwap } from "@/components/page-swap";
import { InviteLink } from "@/components/invite-link";
import { PeopleBoard } from "@/components/people-board";
import { useAuth } from "@/lib/use-auth";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { invalidate, peek, put } from "@/lib/cache";
import { reportDataReady } from "@/lib/rum";
import { type PersonDraft, toDraft, unclaimed } from "@/lib/people-board";
import { spriteByName } from "@/lib/sprite-by-name";
import type { Character } from "@/types/character";
import type { Invite } from "@/types/invite";
import type { Party, Person, SavePeopleBody, SeatedParty } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

const PEOPLE_KEY = "/api/people";
const PARTIES_KEY = "/api/parties";
const SEATED_KEY = "/api/parties/seated";
const CHARACTERS_KEY = "/api/characters";
const INVITES_KEY = "/api/invites";

// Who plays which character. Kept apart from the parties on purpose: a party names characters, and
// this says whose they are, once, for every party that names them. Say it here and CreedBratton is
// Chris's everywhere he turns up.
//
// The characters are the sprites they are in every other roster, because that is what makes the
// unclaimed pile readable: a column of unfamiliar names is the thing you cannot sort, and a column
// of faces is. Parties are fetched for the seats and for their art, own characters for the art of
// yours, which is the newer of the two. See lib/sprite-by-name.ts.
//
// The parties you are IN are read as well as the ones you own. An account that arrived by a link
// owns no config, so its every face came from the one list it has nothing in.
export default function PeoplePage() {
  const { getToken, isLoaded } = useAuth();

  const [people, setPeople] = useState<Person[]>(peek<Person[]>(PEOPLE_KEY) ?? []);
  const [parties, setParties] = useState<Party[]>(peek<Party[]>(PARTIES_KEY) ?? []);
  const [seated, setSeated] = useState<SeatedParty[]>(peek<SeatedParty[]>(SEATED_KEY) ?? []);
  const [characters, setCharacters] = useState<Character[]>(
    peek<Character[]>(CHARACTERS_KEY) ?? [],
  );
  const [draft, setDraft] = useState<PersonDraft[]>([]);
  // Which person's link is being made right now, for the length of the request only. The button
  // that started it says so; nothing else on the board changes.
  const [inviting, setInviting] = useState<string | null>(null);
  // The link the dialog is open on, which is the whole of what it shows. Null is no dialog.
  const [invite, setInvite] = useState<Invite | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [state, setState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Not before Clerk answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Person[]>(PEOPLE_KEY, { method: "GET" }, withToken),
          apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          apiFetch<SeatedParty[]>(SEATED_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([peopleResult, partyResult, characterResult, seatedResult]) => {
        setPeople(peopleResult);
        setDraft(toDraft(peopleResult));
        setParties(partyResult);
        setCharacters(characterResult);
        setSeated(seatedResult);
        put(PEOPLE_KEY, peopleResult);
        put(PARTIES_KEY, partyResult);
        put(CHARACTERS_KEY, characterResult);
        put(SEATED_KEY, seatedResult);
        setState("loaded");
        reportDataReady();
      })
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  /**
   * Takes the account off a person, and their seats in your parties with it.
   *
   * The server answers with the whole people list, so the row redraws from what is now true rather
   * than from an assumption about what the press did. Their seats stop being theirs at the same
   * moment: see UnlinkPerson.kt, where the revoking is the half that matters.
   */
  async function unlinkPerson(personId: string) {
    setBusy(true);
    setError(null);
    try {
      const saved = await apiFetch<Person[]>(
        `${PEOPLE_KEY}/${encodeURIComponent(personId)}/link`,
        { method: "DELETE" },
        getToken,
      );
      setPeople(saved);
      setDraft(toDraft(saved));
      put(PEOPLE_KEY, saved);
      // Every party read carries whose seat is whose, and one of them just stopped being theirs.
      invalidate("/api/parties");
    } catch {
      setError("Couldn't unlink them.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const body: SavePeopleBody = {
      people: draft
        .filter((row) => row.name.trim() !== "")
        .map((row) => ({
          ...(row.id ? { id: row.id } : {}),
          name: row.name.trim(),
          characters: row.characters,
        })),
    };
    setBusy(true);
    setError(null);
    try {
      const saved = await apiFetch<Person[]>(
        PEOPLE_KEY,
        { method: "PUT", body: JSON.stringify(body) },
        getToken,
      );
      setPeople(saved);
      setDraft(toDraft(saved));
      put(PEOPLE_KEY, saved);
    } catch (e) {
      // The backend refuses with the reason (see validatePeople): two people sharing a name, or
      // both claiming the same character. Both are worth reading rather than "went wrong".
      setError(e instanceof ApiError ? e.body : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(people));

  /**
   * Makes the link, and only then opens the dialog on it.
   *
   * Not inside the dialog. Opening first and filling in afterwards put an empty box and a
   * "Making a link..." on screen for as long as the round trip took, and the swap to the real
   * link read as a flicker. A dialog whose whole content is one result should not exist before
   * the result does; the wait belongs on the button that started it.
   */
  async function invitePerson(personId: string) {
    setInviting(personId);
    setInviteError(null);
    try {
      const made = await apiFetch<Invite>(
        INVITES_KEY,
        { method: "POST", body: JSON.stringify({ personId }) },
        getToken,
      );
      setInvite(made);
    } catch {
      setInviteError("Couldn't make a link.");
    } finally {
      setInviting(null);
    }
  }

  const sprites = spriteByName(characters, [...parties, ...seated]);
  const mine = characters.map((c) => c.name);
  // Against the DRAFT, not the saved list: a character dragged onto somebody has to leave the pile
  // as it is dropped, before anything is saved.
  const unassigned = unclaimed(parties, draft, mine);
  // Every character named anywhere, for the add box to complete against. The same three sources the
  // party editor uses, so a name typed here matches the one a roster already holds.
  const knownCharacters = Array.from(
    new Set([...mine, ...draft.flatMap((p) => p.characters), ...unassigned]),
  ).sort();

  return (
    <main className="page">
      <p className="loot-back">
        <Link href="/bosses/parties/edit">&larr; Edit Parties</Link>
      </p>
      <h1 className="page-title">Edit People</h1>

      {state === "error" && <p>Couldn&apos;t load your people.</p>}
      <PageSwap
        waiting={state === "loading"}
        placeholder={<p className="party-hint">Loading...</p>}
      >
        {state === "loaded" && (
          <>
            <PeopleBoard
              people={draft}
              unassigned={unassigned}
              knownCharacters={knownCharacters}
              spriteFor={(name) => sprites.get(name) ?? null}
              busy={busy}
              onChange={setDraft}
              onRename={(index, name) =>
                setDraft(draft.map((r, i) => (i === index ? { ...r, name } : r)))
              }
              onRemove={(index) => setDraft(draft.filter((_, i) => i !== index))}
              unsaved={dirty}
              inviting={inviting}
              onInvite={invitePerson}
              onUnlink={unlinkPerson}
            />

            {invite !== null && (
              <InviteLink
                person={invite.personName}
                invite={invite}
                onClose={() => setInvite(null)}
              />
            )}

            <div className="loot-actions">
              <button
                type="button"
                className="party-add-seat"
                onClick={() => setDraft([...draft, { name: "", characters: [], owned: [] }])}
              >
                + Person
              </button>
              <button type="button" className="party-save" disabled={busy || !dirty} onClick={save}>
                {busy ? "Saving..." : "Save people"}
              </button>
              {error && <span className="split-error">{error}</span>}
              {inviteError && <span className="split-error">{inviteError}</span>}
            </div>
          </>
        )}
      </PageSwap>
    </main>
  );
}
