"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AddCharacter } from "@/components/add-character";
import { WorldChoice } from "@/components/world-choice";
import { apiFetch } from "@/lib/api";
import { bossLabel } from "@/lib/boss-difficulty";
import { partyHref } from "@/lib/party-path";
import { ownMember } from "@/lib/parties";
import { useAccountSettings } from "@/lib/use-account-settings";
import { useAuth } from "@/lib/use-auth";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { SeatedParty } from "@/types/party";

// A new account's first three steps: the world, the characters, the parties they are already in.
//
// Reached from an invite's accept and from the home page while no world is set. Every control is
// the one the rest of the app uses, so there is nothing here to keep in step with those pages.

const STEPS = ["World", "Characters", "Parties"] as const;

export default function Welcome() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const settings = useAccountSettings();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [characters, setCharacters] = useState<Character[] | null>(null);
  const [seated, setSeated] = useState<SeatedParty[] | null>(null);
  const [bosses, setBosses] = useState<Boss[]>([]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isLoaded && !isSignedIn) router.replace("/");
  }, [isLoaded, isSignedIn, router]);

  // Re-read on every step, because each one changes the next: a world narrows the characters, and a
  // character added can take a seat the sender already made for it.
  useEffect(() => {
    // Not before auth answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    if (!isSignedIn || step === 0) return;
    const read =
      step === 1
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

  return (
    <main className="page">
      <ol className="welcome-steps">
        {STEPS.map((label, i) => (
          <li key={label} className={i === step ? "is-current" : undefined}>
            {label}
          </li>
        ))}
      </ol>

      {step === 0 && <WorldChoice chosen={settings.worldType} onChosen={() => setStep(1)} />}

      {step > 0 && <h1 className="page-title">{STEPS[step]}</h1>}
      {failed && (
        <p className="routine-error">Couldn&apos;t load this step. Reload to try again.</p>
      )}

      {step === 1 && characters && (
        <>
          {characters.length > 0 && (
            <ul className="welcome-list">
              {characters.map((c) => (
                <li key={c.id}>{c.name}</li>
              ))}
            </ul>
          )}
          <AddCharacter onAdded={(c) => setCharacters([...characters, c])} />
          <div className="loot-actions">
            <button type="button" className="party-cancel" onClick={() => setStep(0)}>
              Back
            </button>
            <button
              type="button"
              className="party-save"
              disabled={characters.length === 0}
              onClick={() => setStep(2)}
            >
              Next
            </button>
          </div>
        </>
      )}

      {step === 2 && seated && (
        <>
          {seated.length > 0 ? (
            <ul className="welcome-list">
              {seated.map(({ party }) => (
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
          <div className="loot-actions">
            <button type="button" className="party-cancel" onClick={() => setStep(1)}>
              Back
            </button>
            <Link className="party-cancel" href="/bosses/parties/edit">
              Set Up a Party
            </Link>
            <button
              type="button"
              className="party-save"
              onClick={() => router.push("/bosses/parties")}
            >
              Finish
            </button>
          </div>
        </>
      )}
    </main>
  );
}
