"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useState } from "react";
import { AddCharacter } from "@/components/add-character";
import { CharacterCard } from "@/components/character-card";
import { WorldChoice } from "@/components/world-choice";
import { apiFetch, spriteUrl } from "@/lib/api";
import { bossLabel } from "@/lib/boss-difficulty";
import { partyHref } from "@/lib/party-path";
import { ownMember } from "@/lib/parties";
import { SETTINGS_KEY, setAccountSettings, useAccountSettings } from "@/lib/use-account-settings";
import { useAuth } from "@/lib/use-auth";
import { WORLDS_IN } from "@/lib/world-names";
import type { WorldType } from "@/lib/world";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { SeatedParty } from "@/types/party";
import type { Settings } from "@/types/settings";

// A new account's first three steps: the world, the characters, the parties they are already in.
//
// Reached from an invite's accept and from the home page while no world is set. Every control is
// the one the rest of the app uses, so there is nothing here to keep in step with those pages.

const STEPS = ["World", "Characters", "Parties"] as const;
// A taste of the parties, not the list: Party View holds every one, and the line under says so.
const PARTIES_SHOWN = 5;

export default function Welcome() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const settings = useAccountSettings();
  const router = useRouter();
  const [step, setShown] = useState(0);
  // The furthest step reached, so going back to correct one leaves the later ones a click away.
  const [reached, setReached] = useState(0);
  const setStep = (next: number) => {
    setShown(next);
    setReached((furthest) => Math.max(furthest, next));
  };
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const [seated, setSeated] = useState<SeatedParty[] | null>(null);
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
      setAccountSettings(
        await apiFetch<Settings>(
          SETTINGS_KEY,
          { method: "PUT", body: JSON.stringify({ worldType: type }) },
          getToken,
        ),
      );
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
      setAccountSettings(
        await apiFetch<Settings>(
          `${SETTINGS_KEY}/main-character`,
          { method: "PUT", body: JSON.stringify({ characterId }) },
          getToken,
        ),
      );
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
          ]).then(([parties, catalog]) => {
            setSeated(parties);
            setBosses(catalog);
          });
    read.then(() => setFailed(false)).catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn, step]);

  if (!isLoaded || !isSignedIn || !settings) return <main className="page" />;

  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const mainCharacter = characters?.find((c) => c.id === settings.mainCharacterId) ?? null;
  const others = characters?.filter((c) => c !== mainCharacter) ?? [];
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
      {main ? (
        <div className="welcome-hero">
          {main.sprite && <img className="hero-sprite" src={spriteUrl(main.sprite)} alt="" />}
          <h1 className="page-title">Welcome, {main.name}</h1>
        </div>
      ) : (
        <h1 className="page-title">Welcome</h1>
      )}
      <nav aria-label="Setup progress">
        <ol className="welcome-steps">
          {STEPS.map((label, i) => {
            const state = i === step ? "is-current" : i <= reached ? "is-done" : "is-todo";
            return (
              <Fragment key={label}>
                {i > 0 && (
                  <li
                    className={
                      i <= reached ? "welcome-step-arrow is-reached" : "welcome-step-arrow"
                    }
                    aria-hidden="true"
                  >
                    {"\u2192"}
                  </li>
                )}
                <li className={`welcome-step ${state}`}>
                  {/* Any step reached can be gone to; the ones past it wait on this one. */}
                  <button
                    type="button"
                    className="welcome-step-link"
                    aria-current={i === step ? "step" : undefined}
                    disabled={i > reached}
                    onClick={() => setStep(i)}
                  >
                    {state === "is-done" ? `\u2713 ${label}` : label}
                  </button>
                </li>
              </Fragment>
            );
          })}
        </ol>
      </nav>

      {step === 0 && (
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
          <h2 className="welcome-step-title">Main Character</h2>
          <ul className="character-cards">
            {mainCharacter ? (
              card(mainCharacter)
            ) : (
              // Held open, so starring a character below has somewhere visible to move it to.
              <li className="character-card is-empty" aria-hidden="true" />
            )}
          </ul>
          {others.length > 0 && (
            <>
              <h2 className="welcome-step-title">Characters</h2>
              <ul className="character-cards">{others.map(card)}</ul>
            </>
          )}
          <h2 className="welcome-step-title">Add Character</h2>
          <AddCharacter onAdded={(c) => setCharacters([...characters, c])} />
        </>
      )}

      {step === 2 && seated && (
        <>
          <h2 className="welcome-step-title">Parties</h2>
          {seated.length > 0 ? (
            <ul className="welcome-list">
              {seated.slice(0, PARTIES_SHOWN).map(({ party }) => (
                <li key={party.id}>
                  <Link href={partyHref(party)}>
                    {[
                      ownMember(party)?.name,
                      bossLabel(
                        bossByKey.get(party.bossKey)?.name ?? party.bossKey,
                        party.difficulty,
                      ),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="party-hint">No parties yet.</p>
          )}
          <p className="party-hint">
            {seated.length > PARTIES_SHOWN && `${seated.length - PARTIES_SHOWN} more. `}
            Parties can be modified under <Link href="/bosses/parties">Party View</Link>.
          </p>
        </>
      )}

      <div className="welcome-nav">
        <span>
          {step > 0 && (
            <button type="button" className="party-cancel" onClick={() => setStep(step - 1)}>
              {"\u2190 Back"}
            </button>
          )}
        </span>
        <span className="welcome-nav-end">
          {step < 2 ? (
            <button
              type="button"
              className="party-save"
              disabled={step === 0 ? chosenWorld === null || savingWorld : mainCharacter === null}
              onClick={() => setStep(step + 1)}
            >
              {"Next \u2192"}
            </button>
          ) : (
            <>
              <Link className="party-cancel" href="/bosses/parties/edit">
                Set Up a Party
              </Link>
              <button
                type="button"
                className="party-save"
                onClick={() => router.push("/bosses/parties")}
              >
                {"Finish \u2192"}
              </button>
            </>
          )}
        </span>
      </div>
    </main>
  );
}
