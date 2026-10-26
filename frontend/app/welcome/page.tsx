"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AddCharacter } from "@/components/add-character";
import { AddForWeek } from "@/components/add-for-week";
import { Button } from "@/components/button";
import { RosterStrip } from "@/components/roster-strip";
import { CharacterCard } from "@/components/character-card";
import { INVITED_STEPS, SETUP_STEPS, WelcomeHeader } from "@/components/welcome-header";
import { WorldChoice } from "@/components/world-choice";
import { apiAssetUrl, apiFetch, failureText, duplicatePartyIn } from "@/lib/api";
import { bossLabel } from "@/lib/boss-difficulty";
import { partyHref } from "@/lib/party-path";
import { hardestFirst } from "@/lib/hardest-first";
import { asYourRow } from "@/lib/parties/member-view";
import { saveMainCharacter, saveWorld, useAccountSettings } from "@/lib/use-account-settings";
import { useAuth } from "@/lib/use-auth";
import { WORLDS_IN } from "@/lib/world-names";
import type { WorldType } from "@/lib/world";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { Party, SavePartyBody, SeatedParty } from "@/types/party";

// A new account's first three steps: the world, the characters, the parties they are already in.
//
// Reached from an invite's accept and from the home page while no world is set. Every control is
// the one the rest of the app uses, so there is nothing here to keep in step with those pages.

// A taste of the parties, not the list: Party View holds every one, and the line under says so.
const PARTIES_SHOWN = 5;

// useSearchParams needs a Suspense boundary above it, or the build cannot prerender the route.
export default function WelcomePage() {
  return (
    <Suspense fallback={<main className="page" />}>
      <Welcome />
    </Suspense>
  );
}

function Welcome() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const settings = useAccountSettings();
  const router = useRouter();
  // Arrived by accepting an invite, which is a step of its own in front of these. A query flag so
  // it survives a reload, and read through the router: on a client navigation the address bar still
  // holds the page being left when this one first renders.
  const invited = useSearchParams().has("invited");
  const lead = invited ? 1 : 0;
  const [step, setShown] = useState(0);
  // The furthest step reached, so going back to correct one leaves the later ones a click away.
  const [reached, setReached] = useState(0);
  const setStep = (next: number) => {
    setShown(next);
    setReached((furthest) => Math.max(furthest, next));
  };
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const [seated, setSeated] = useState<SeatedParty[] | null>(null);
  const [ownParties, setOwnParties] = useState<Party[]>([]);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  /** A standing party of their own, through the route Party View's Add Party uses. */
  async function addParty(body: SavePartyBody) {
    setAdding(true);
    setAddError(null);
    try {
      await apiFetch<Party>(
        "/api/parties",
        { method: "POST", body: JSON.stringify(body) },
        getToken,
      );
      setOwnParties(await apiFetch<Party[]>("/api/parties", { method: "GET" }, getToken));
    } catch (e) {
      if (duplicatePartyIn(e)) throw e;
      setAddError(failureText(e, "Couldn't add that party. Try again."));
    } finally {
      setAdding(false);
    }
  }
  const [bosses, setBosses] = useState<Boss[]>([]);
  const [failed, setFailed] = useState(false);
  const [settingMain, setSettingMain] = useState(false);
  // The world picked here, by name. The account stores only its category, so before anything is
  // picked the card that reads as chosen is the world the account's characters are in.
  const [pickedWorld, setPickedWorld] = useState<string | null>(null);
  const [savingWorld, setSavingWorld] = useState(false);

  /** Picks [world], saving its category when that is not the one the account already holds. */
  async function chooseWorld(world: string, type: WorldType) {
    setPickedWorld(world);
    if (settings?.worldType === type) return;
    setSavingWorld(true);
    try {
      await saveWorld(type, getToken);
    } catch {
      setPickedWorld(null);
      setFailed(true);
    } finally {
      setSavingWorld(false);
    }
  }

  /** Stars [characterId] as the account's main, through the route the Characters page uses. */
  async function setMain(characterId: string) {
    setSettingMain(true);
    try {
      await saveMainCharacter(characterId, getToken);
    } catch {
      setFailed(true);
    } finally {
      setSettingMain(false);
    }
  }

  useEffect(() => {
    if (isLoaded && !isSignedIn) router.replace("/");
  }, [isLoaded, isSignedIn, router]);

  // Re-read on every step, because each one changes the next: a world narrows the characters, and a
  // character added can take a seat the sender already made for it.
  useEffect(() => {
    // Not before auth answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    if (!isSignedIn) return;
    const read =
      step < 2
        ? apiFetch<Character[]>("/api/characters", { method: "GET" }, getToken).then(setCharacters)
        : Promise.all([
            apiFetch<SeatedParty[]>("/api/parties/seated", { method: "GET" }, getToken),
            apiFetch<Boss[]>("/api/bosses", { method: "GET" }, getToken),
            apiFetch<Party[]>("/api/parties", { method: "GET" }, getToken),
            apiFetch<Character[]>("/api/characters", { method: "GET" }, getToken),
          ]).then(([parties, catalog, own, mine]) => {
            setSeated(parties);
            setBosses(catalog);
            setOwnParties(own);
            setCharacters(mine);
          });
    read.then(() => setFailed(false)).catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, step]);

  if (!isLoaded || !isSignedIn || !settings) return <main className="page" />;

  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  // Their own parties first, then the ones they are seated in. Solo pools are not parties.
  //
  // A seated party is the owner's row, so its `characterId`s are the OWNER'S characters and the
  // roster would mark them as yours. Re-marked here against the seats that are this account's.
  // The main runs it: their own party run on the main, or one they are seated in as the main. A
  // seated party is filed under their own character in it, so both read the same. See asYourRow.
  const listed = hardestFirst(
    [...ownParties.filter((p) => !p.solo && !p.retired), ...(seated ?? []).map(asYourRow)].map(
      (party) => ({ party, main: party.characterId === settings.mainCharacterId }),
    ),
  );
  const mainCharacter = characters?.find((c) => c.id === settings.mainCharacterId) ?? null;
  const card = (c: Character) => (
    <CharacterCard
      key={c.id}
      character={c}
      isMain={c === mainCharacter}
      onStar={() => void setMain(c.id)}
      starBusy={settingMain}
    />
  );
  // Of the worlds in the account's category, the one its characters are in: the main's first.
  const inCategory = settings.worldType ? WORLDS_IN[settings.worldType] : [];
  const worldOf = (c: Character | null | undefined) =>
    c?.worldName && inCategory.includes(c.worldName) ? c.worldName : null;
  const chosenWorld =
    pickedWorld ?? worldOf(mainCharacter) ?? worldOf(characters?.find((c) => worldOf(c))) ?? null;
  const main = settings.mainCharacterName
    ? { name: settings.mainCharacterName, sprite: settings.mainCharacterSprite }
    : null;

  return (
    <main className="page">
      <WelcomeHeader
        main={main}
        steps={invited ? INVITED_STEPS : SETUP_STEPS}
        step={step + lead}
        reached={reached + lead}
        locked={lead}
        onStep={(i) => setStep(i - lead)}
      />

      {/* Held until the characters are in: the world they are in is the card drawn as picked. */}
      {step === 0 && characters && (
        <WorldChoice
          chosen={chosenWorld}
          busy={savingWorld}
          onChoose={(world, type) => void chooseWorld(world, type)}
        />
      )}

      {failed && (
        <p className="routine-error">Couldn&apos;t load this step. Reload to try again.</p>
      )}

      {step === 1 && characters && (
        <>
          <h2 className="welcome-step-title">Characters</h2>
          <p className="party-hint welcome-hint">
            Click the Star to designate your main character.
          </p>
          {characters.length > 0 && <ul className="character-cards">{characters.map(card)}</ul>}
          <h2 className="welcome-step-title">Add Character</h2>
          <AddCharacter onAdded={(c) => setCharacters([...characters, c])} />
        </>
      )}

      {step === 2 && seated && (
        <>
          <h2 className="welcome-step-title">Parties</h2>
          {listed.length > 0 ? (
            <ul className="welcome-parties">
              {listed.slice(0, PARTIES_SHOWN).map((party) => {
                const boss = bossByKey.get(party.bossKey);
                return (
                  <li key={party.id}>
                    <Link className="welcome-party" href={partyHref(party)}>
                      {boss?.iconUrl ? (
                        <img className="boss-portrait" src={apiAssetUrl(boss.iconUrl)} alt="" />
                      ) : (
                        <span className="boss-portrait is-empty" aria-hidden="true" />
                      )}
                      <span className="welcome-party-name">
                        {bossLabel(boss?.name ?? party.bossKey, party.difficulty)}
                      </span>
                      <RosterStrip members={party.members} />
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="party-hint">No parties yet.</p>
          )}
          <p className="party-hint">
            {listed.length > PARTIES_SHOWN && `${listed.length - PARTIES_SHOWN} more. `}
            Parties can be modified under <Link href="/bosses/parties">Party View</Link>.
          </p>
          {characters && characters.length > 0 && (
            <AddForWeek
              characters={characters}
              bosses={bosses}
              parties={ownParties}
              busy={adding}
              error={addError}
              standing
              onAdd={addParty}
            />
          )}
        </>
      )}

      <div className="welcome-nav">
        <span>
          {step > 0 && (
            <Button variant="secondary" onClick={() => setStep(step - 1)}>
              {"\u2190 Back"}
            </Button>
          )}
        </span>
        <span className="welcome-nav-end">
          {step < 2 ? (
            <Button
              variant="primary"
              disabled={step === 0 ? chosenWorld === null || savingWorld : mainCharacter === null}
              onClick={() => setStep(step + 1)}
            >
              {"Next \u2192"}
            </Button>
          ) : (
            <>
              <Button variant="primary" onClick={() => router.push("/bosses/parties")}>
                {"Finish \u2192"}
              </Button>
            </>
          )}
        </span>
      </div>
    </main>
  );
}
