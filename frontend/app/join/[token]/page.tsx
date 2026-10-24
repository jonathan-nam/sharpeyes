"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Button } from "@/components/button";
import { INVITED_STEPS, WelcomeHeader } from "@/components/welcome-header";
import { PageSwap } from "@/components/page-swap";
import { SignInButton } from "@/components/sign-in-button";
import { ApiError, apiFetch, failureText, spriteUrl } from "@/lib/api";
import { reportDataReady } from "@/lib/rum";
import { reloadAccountSettings, useAccountSettings } from "@/lib/use-account-settings";
import { joinCallbackPath } from "@/lib/invite-link";
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
  const settings = useAccountSettings();

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  // The route cannot match without a segment, so the empty case is only reachable by a hand-typed
  // URL. Decided at first render rather than in the effect below: a state set synchronously in one
  // is a cascading render, and this needs no fetch to know the answer.
  const [state, setState] = useState<LoadState>(token === "" ? "gone" : "loading");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (token === "") return;
    apiFetch<InvitePreview>(`/api/join/${encodeURIComponent(token)}`, { method: "GET" }, noToken)
      .then((result) => {
        setPreview(result);
        setState("loaded");
        reportDataReady();
      })
      // Unknown, expired and already used are one answer from the backend on purpose, so they are
      // one answer here too.
      .catch((e) => setState(e instanceof ApiError && e.status === 404 ? "gone" : "error"));
  }, [token]);

  async function accept() {
    // Read before accepting, which may set the account up: an account that already had a main has
    // done onboarding, and goes to the parties it just joined instead.
    const setUp = Boolean(settings?.mainCharacterId);
    setBusy(true);
    setProblem(null);
    try {
      await apiFetch<AcceptedInvite>(
        `/api/invites/${encodeURIComponent(token)}/accept`,
        { method: "POST", body: JSON.stringify({ characters: preview?.characters ?? [] }) },
        getToken,
      );
      // Accepting can set the account's world, and the settings this tab already holds were read
      // before it did. Without this, /welcome drew no world as chosen.
      await reloadAccountSettings(getToken);
      // Replace, not push: the token is spent, so the back button must not return to a page
      // offering to spend it.
      router.replace(setUp ? "/bosses/parties" : "/welcome?invited");
    } catch (e) {
      // The backend refuses with the reason: an account that already has characters, your own
      // link, or one made before the payload changed shape. Each is worth reading.
      setProblem(failureText(e, "Couldn't set that up. Try again."));
      setBusy(false);
    }
  }

  return (
    <main className="page">
      {/* The first of the steps /welcome carries on with, so the two read as one flow. */}
      <WelcomeHeader main={null} steps={INVITED_STEPS} step={0} reached={0} />
      <section className="auth-panel">
        {/* Unknown, expired and already used are one answer from the backend on purpose, so this
            claims none of the three and says the only thing that helps either way. The lifetime is
            deliberately not quoted here: it lives in INVITE_LIFETIME, and a number repeated in copy
            is a number that goes wrong when the constant moves. */}
        {state === "gone" && (
          <>
            <h2>This link doesn&apos;t work.</h2>
            <p className="party-hint">Ask for a new one.</p>
          </>
        )}
        {state === "error" && <h2>Couldn&apos;t open this link. Reload to try again.</h2>}

        <PageSwap
          waiting={state === "loading"}
          placeholder={<p className="party-hint">Loading...</p>}
        >
          {state === "loaded" && preview && (
            <>
              <div className="join-sender">
                <h2>{preview.senderName} set up your parties</h2>
                {preview.senderSprite && (
                  <img className="hero-sprite" src={spriteUrl(preview.senderSprite)} alt="" />
                )}
              </div>
              {/* The characters and parties are the next steps' to show, and they arrive filled in:
                  every character the sender named is taken, and correctable once it is yours. */}
              <p className="party-hint">
                We&apos;ve pre-filled some of your character and party information.
              </p>

              <div className="join-act">
                {isLoaded && !isSignedIn && <SignInButton callbackPath={joinCallbackPath(token)} />}
                {isLoaded && isSignedIn && (
                  <Button
                    variant="primary"
                    disabled={busy || !preview || preview.characters.length === 0}
                    onClick={accept}
                  >
                    {busy ? "Setting Up..." : "Set Up My Account"}
                  </Button>
                )}
              </div>
              {problem && <p className="split-error">{problem}</p>}
            </>
          )}
        </PageSwap>
      </section>
    </main>
  );
}
