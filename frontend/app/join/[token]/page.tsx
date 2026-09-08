"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PageSwap } from "@/components/page-swap";
import { SignInButton } from "@/components/sign-in-button";
import { ApiError, apiFetch } from "@/lib/api";
import { reportDataReady } from "@/lib/rum";
import {
  invitedSummary,
  joinCallbackPath,
  omittedSummary,
  partiesShown,
  partiesTaken,
  partyLabel,
} from "@/lib/invite-link";
import { useAuth } from "@/lib/use-auth";
import type { AcceptedInvite, InvitePreview } from "@/types/invite";

// The other end of a sign-on link. Reachable signed out, which is the whole point: it has to say
// what the link gives you before you decide whether to make an account for it.
//
// The token stays in the URL across the Discord round trip rather than being stashed anywhere. It
// is already in the address that was opened, so coming back to the same address carries it, and
// there is no cookie to write and then remember to clear.

type LoadState = "loading" | "loaded" | "gone" | "error";

/** Unauthenticated. /api/join is mounted outside the authenticated block; the token is the authority. */
const noToken = () => Promise.resolve(null);

export default function JoinPage() {
  const token = String(useParams().token ?? "");
  const router = useRouter();
  const { getToken, isSignedIn, isLoaded } = useAuth();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  // The route cannot match without a segment, so the empty case is only reachable by a hand-typed
  // URL. Decided at first render rather than in the effect below: a state set synchronously in one
  // is a cascading render, and this needs no fetch to know the answer.
  const [state, setState] = useState<LoadState>(token === "" ? "gone" : "loading");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /**
   * The characters ticked as yours, or null before the preview has said what they are.
   *
   * All of them to begin with. The sender is usually right, and a screen that starts with nothing
   * ticked asks everybody to do the work for the rare case where they are not.
   */
  const [mine, setMine] = useState<string[] | null>(null);

  useEffect(() => {
    if (token === "") return;
    apiFetch<InvitePreview>(`/api/join/${encodeURIComponent(token)}`, { method: "GET" }, noToken)
      .then((result) => {
        setPreview(result);
        setMine(result.characters);
        setState("loaded");
        reportDataReady();
      })
      // Unknown, expired and already used are one answer from the backend on purpose, so they are
      // one answer here too.
      .catch((e) => setState(e instanceof ApiError && e.status === 404 ? "gone" : "error"));
  }, [token]);

  async function accept() {
    setBusy(true);
    setProblem(null);
    try {
      await apiFetch<AcceptedInvite>(
        `/api/invites/${encodeURIComponent(token)}/accept`,
        { method: "POST", body: JSON.stringify({ characters: mine ?? [] }) },
        getToken,
      );
      // Replace, not push: the token is spent, so the back button must not return to a page
      // offering to spend it.
      router.replace("/bosses/people");
    } catch (e) {
      // The backend refuses with the reason: an account that already has characters, your own
      // link, or one made before the payload changed shape. Each is worth reading.
      setProblem(e instanceof ApiError && e.body !== "" ? e.body : "Couldn't set that up.");
      setBusy(false);
    }
  }

  return (
    <main className="page">
      <section className="auth-panel">
        {/* Unknown, expired and already used are one answer from the backend on purpose, so this
            claims none of the three and says the only thing that helps either way. The lifetime is
            deliberately not quoted here: it lives in INVITE_LIFETIME, and a number repeated in copy
            is a number that goes wrong when the constant moves. */}
        {state === "gone" && (
          <>
            <h1>This link doesn&apos;t work.</h1>
            <p className="party-hint">Ask whoever sent it for a new one.</p>
          </>
        )}
        {state === "error" && <h1>Couldn&apos;t open this link.</h1>}

        <PageSwap
          waiting={state === "loading"}
          placeholder={<p className="party-hint">Loading...</p>}
        >
          {state === "loaded" && preview && (
            <>
              <h1>{preview.senderName} set up your parties</h1>

              {/* Ticked, because it is the one thing on a link that has to be right. These names
                  are the SENDER'S spelling of your characters, and one taken by mistake is a
                  character you never added, a seat bound to it, and a figure in your Drop Log for a
                  share you are not owed. The parties below are not ticked: you are a reader of
                  those, so there is nothing there for you to get wrong. */}
              <ul className="join-characters">
                {preview.characters.map((name) => (
                  <li key={name}>
                    <label>
                      <input
                        type="checkbox"
                        checked={mine?.includes(name) ?? false}
                        disabled={busy}
                        onChange={(e) =>
                          setMine((was) =>
                            e.target.checked
                              ? [...(was ?? []), name]
                              : (was ?? []).filter((n) => n !== name),
                          )
                        }
                      />
                      {name}
                    </label>
                  </li>
                ))}
              </ul>

              {/* Of what the ticks above will actually bring, not of what the link holds: a config
                  binds no seat unless the name on it was confirmed, so a count of all of them would
                  be a number accepting does not deliver. */}
              {(() => {
                const taken = partiesTaken(preview.parties, mine ?? []);
                const { shown, more } = partiesShown(taken);
                return (
                  <>
                    <p className="party-hint">
                      {invitedSummary({
                        parties: taken.length,
                        peopleCount: preview.peopleCount,
                      })}
                    </p>
                    {/* A few of them, to recognise the group by. The count above says how many
                        there are, and every one would be a wall on the first screen anybody
                        sees. */}
                    {shown.length > 0 && (
                      <p className="party-hint join-parties">
                        {shown.map(partyLabel).join(", ")}
                        {more > 0 && `, and ${more} more`}
                      </p>
                    )}
                  </>
                );
              })()}
              {preview.omitted.length > 0 && (
                <p className="party-hint">{omittedSummary(preview.omitted)}</p>
              )}

              {isLoaded && !isSignedIn && <SignInButton callbackPath={joinCallbackPath(token)} />}
              {isLoaded && isSignedIn && (
                <button
                  type="button"
                  className="party-save"
                  disabled={busy || (mine?.length ?? 0) === 0}
                  onClick={accept}
                >
                  {busy ? "Setting up..." : "Set up my account"}
                </button>
              )}
              {problem && <p className="split-error">{problem}</p>}
            </>
          )}
        </PageSwap>
      </section>
    </main>
  );
}
