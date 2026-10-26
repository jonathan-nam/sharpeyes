"use client";

import { Button } from "@/components/button";
import { PageSwap } from "@/components/page-swap";
import { InviteLink } from "@/components/invite-link";
import { PEOPLE_KEY, createInvite, savePeople } from "@/lib/people-writes";
import { PeopleBoard } from "@/components/people-board";
import { SectionNav } from "@/components/section-nav";
import { SocialHead } from "@/components/social-head";
import { useAuth } from "@/lib/use-auth";
import { useLive } from "@/lib/use-live";
import { useEffect, useState } from "react";
import { apiFetch, failureText } from "@/lib/api";
import { invalidate, peek, put } from "@/lib/cache";
import { friendsChanged } from "@/lib/friends-changed";
import { reportDataReady } from "@/lib/rum";
import { type PersonDraft, peopleBody, sectionsOf, toDraft, unclaimed } from "@/lib/people-board";
import { useCharacterSprites } from "@/lib/ign-sprites";
import { knownSprite, spriteByName } from "@/lib/sprite-by-name";
import type { Character } from "@/types/character";
import type { Invite } from "@/types/invite";
import type { Party, Person, SeatedParty } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

const PARTIES_KEY = "/api/parties";
const SEATED_KEY = "/api/parties/seated";
const CHARACTERS_KEY = "/api/characters";

// Who plays which character. Kept apart from the parties on purpose: a party names characters, and
// this says whose they are, once, for every party that names them. Say it here and Pinewick is
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

  // An account linked or unlinked from the other side moves who is whose, and a request answered
  // clears its row. Only while nothing here is unsaved: re-reading under a half-edited board would
  // throw the edit away.
  useLive(["party", "friends"], () => {
    if (JSON.stringify(draft) !== JSON.stringify(toDraft(people))) return;
    void apiFetch<Person[]>(PEOPLE_KEY, { method: "GET" }, getToken)
      .then((saved) => {
        setPeople(saved);
        setDraft(toDraft(saved));
        put(PEOPLE_KEY, saved);
      })
      .catch(() => {});
  });

  /** Sends a friend request naming this person. Why it was refused, said in its dialog, or null. */
  async function linkPerson(personId: string, username: string): Promise<string | null> {
    setBusy(true);
    try {
      const saved = await apiFetch<Person[]>(
        `${PEOPLE_KEY}/${encodeURIComponent(personId)}/link`,
        { method: "POST", body: JSON.stringify({ username }) },
        getToken,
      );
      setPeople(saved);
      setDraft(toDraft(saved));
      put(PEOPLE_KEY, saved);
      // They may have asked first, which makes this an acceptance: off the bell, onto parties.
      invalidate("/api/parties");
      invalidate("/api/friends");
      friendsChanged();
      return null;
    } catch (e) {
      return failureText(e, "Couldn't send that. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function cancelLink(requestId: string) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch(
        `/api/friends/requests/${encodeURIComponent(requestId)}`,
        { method: "DELETE" },
        getToken,
      );
      const saved = await apiFetch<Person[]>(PEOPLE_KEY, { method: "GET" }, getToken);
      setPeople(saved);
      setDraft(toDraft(saved));
      put(PEOPLE_KEY, saved);
      invalidate("/api/friends");
    } catch {
      setError("Couldn't cancel it.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    const body = peopleBody(draft);
    setBusy(true);
    setError(null);
    try {
      const saved = await savePeople(body, getToken);
      setPeople(saved);
      setDraft(toDraft(saved));
      put(PEOPLE_KEY, saved);
    } catch (e) {
      // The backend refuses with the reason (see validatePeople): two people sharing a name, or
      // both claiming the same character. Both are worth reading rather than "went wrong".
      setError(failureText(e, "Couldn't save that. Try again."));
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
      const made = await createInvite(personId, getToken);
      setInvite(made);
    } catch {
      setInviteError("Couldn't make a link.");
    } finally {
      setInviting(null);
    }
  }

  const sprites = spriteByName(characters, [...parties, ...seated.map((row) => row.party)]);
  const mine = characters.map((c) => c.name);
  // Against the DRAFT, not the saved list: a character dragged onto somebody has to leave the pile
  // as it is dropped, before anything is saved.
  const unassigned = unclaimed(parties, draft, mine);
  // Every character named anywhere, for the add box to complete against. The same three sources the
  // party editor uses, so a name typed here matches the one a roster already holds.
  const knownCharacters = Array.from(
    new Set([...mine, ...draft.flatMap((p) => p.characters), ...unassigned]),
  ).sort();
  const spriteFor = useCharacterSprites(
    [...draft.flatMap((p) => [...p.characters, ...p.owned]), ...unassigned],
    knownSprite(sprites, people),
  );

  return (
    <main className="page">
      <SocialHead current="people" />

      {state === "error" && <p>Couldn&apos;t load your people. Reload to try again.</p>}
      <PageSwap
        waiting={state === "loading"}
        placeholder={<p className="party-hint">Loading...</p>}
      >
        {state === "loaded" && (
          <SectionNav
            sections={[
              ...sectionsOf(draft).map((s) => ({ id: s.id, label: s.title })),
              { id: "unassigned", label: "Unassigned" },
            ]}
          >
            <PeopleBoard
              people={draft}
              unassigned={unassigned}
              knownCharacters={knownCharacters}
              spriteFor={spriteFor}
              busy={busy}
              onChange={setDraft}
              onRename={(index, name) =>
                setDraft(draft.map((r, i) => (i === index ? { ...r, name } : r)))
              }
              onRemove={(index) => setDraft(draft.filter((_, i) => i !== index))}
              unsaved={dirty}
              inviting={inviting}
              onInvite={invitePerson}
              onLink={linkPerson}
              onCancelLink={cancelLink}
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
                Add Person
              </button>
              <Button variant="primary" disabled={busy || !dirty} onClick={save}>
                {busy ? "Saving..." : "Save People"}
              </Button>
              {error && <span className="split-error">{error}</span>}
              {inviteError && <span className="split-error">{inviteError}</span>}
            </div>
          </SectionNav>
        )}
      </PageSwap>
    </main>
  );
}
