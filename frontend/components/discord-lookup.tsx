"use client";

import { useEffect, useState } from "react";
import { DiscordAvatar } from "@/components/discord-avatar";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/use-auth";

/** Who a typed Discord username reaches. See backend FriendViews.kt lookupFor. */
export type DiscordFound = {
  username: string;
  image: string | null;
  /** Their main character, which is how the bell names them. */
  name: string | null;
  spriteImgUrl: string | null;
  you: boolean;
};

/** What is known about a typed name: not asked yet, the lookup failed, nobody, or somebody. */
export type DiscordLookupState = "idle" | "failed" | "none" | DiscordFound;

/** Long enough that a name is asked once it is typed, not once per letter. */
const LOOKUP_DELAY_MS = 300;

/**
 * Whose account [value] reaches, asked as it is typed. Social's Send Request and People's Link
 * Account share it, with the box below, so a request goes to the person meant.
 */
export function useDiscordLookup(value: string): DiscordLookupState {
  const { getToken, isLoaded } = useAuth();
  // The answer, with the name it answered: one for a name since edited is not shown.
  const [answer, setAnswer] = useState<{ asked: string; state: DiscordLookupState } | null>(null);
  const wanted = value.trim().replace(/^@/, "").toLowerCase();

  useEffect(() => {
    // Not before auth answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    if (!wanted) return;
    let live = true;
    const timer = setTimeout(() => {
      apiFetch<{ found: DiscordFound | null }>(
        `/api/friends/lookup?username=${encodeURIComponent(wanted)}`,
        { method: "GET" },
        getToken,
      )
        .then((r) => live && setAnswer({ asked: wanted, state: r.found ?? "none" }))
        // A failed lookup says nothing about the name, so it is not "none".
        .catch(() => live && setAnswer({ asked: wanted, state: "failed" }));
    }, LOOKUP_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, isLoaded]);

  return wanted && answer?.asked === wanted ? answer.state : "idle";
}

/**
 * Whether a request for [value] may be sent: refused only once the lookup has said nobody, or you.
 * A lookup still pending or one that failed blocks nothing, because the request is checked by the
 * server anyway, and gating on the preview took sending down whenever the lookup could not answer.
 */
export function mayAsk(value: string, state: DiscordLookupState): boolean {
  if (value.trim() === "" || state === "none") return false;
  return typeof state === "string" || !state.you;
}

/** The username box, and under it whose account the name reaches. */
export function DiscordLookup({
  value,
  state,
  onChange,
  disabled,
  autoFocus,
}: {
  value: string;
  state: DiscordLookupState;
  onChange: (value: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  return (
    <div className="discord-lookup">
      <input
        type="text"
        className="split-input"
        value={value}
        placeholder="Discord username"
        aria-label="Discord username"
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="discord-lookup-preview" aria-live="polite">
        {typeof state !== "string" ? (
          <>
            {state.image ? (
              <DiscordAvatar image={state.image} size="lg" />
            ) : (
              <span className="discord-avatar is-lg" aria-hidden="true" />
            )}
            <span className="discord-lookup-who">
              <span className="tile-name">{state.name ?? state.username}</span>
              <span className="tile-meta">
                @{state.username}
                {state.you && " (you)"}
              </span>
            </span>
          </>
        ) : state === "none" ? (
          <span className="party-hint">No match</span>
        ) : state === "failed" ? (
          <span className="party-hint">Couldn&apos;t look that up</span>
        ) : null}
      </div>
    </div>
  );
}
