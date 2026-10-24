"use client";

import { useEffect, useState } from "react";
import { DiscordAvatar } from "@/components/discord-avatar";
import { apiFetch, failureText } from "@/lib/api";
import { bossLabel } from "@/lib/boss-difficulty";
import { invalidate } from "@/lib/cache";
import { onFriendsChanged } from "@/lib/friends-changed";
import { formatDropped } from "@/lib/loot";
import { useAuth } from "@/lib/use-auth";
import { useLive } from "@/lib/use-live";
import type { CombinePage, CombinePair, CombineSide } from "@/types/combine";

const COMBINE_KEY = "/api/party-combines";

// Social's section for two linked owners who each keep a party for the same boss and people. One is
// kept and the other retired, once both agree which. Drops before the shared date stay in each
// owner's own book, so nothing on either side is moved or counted twice. See backend
// CombineParties.kt. On Social because only a friend's parties can be combined.
export function CombineParties() {
  const { getToken, isLoaded } = useAuth();
  const [page, setPage] = useState<CombinePage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    return apiFetch<CombinePage>(COMBINE_KEY, { method: "GET" }, getToken)
      .then(setPage)
      .catch(() => {});
  }

  useEffect(() => {
    // Not before auth answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  // The other owner asked, answered, or changed a roster; a new friend can bring a pair.
  useLive(["notifications", "party", "friends"], () => void load());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onFriendsChanged(() => void load()), []);

  async function act(path: string, init: RequestInit, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      setPage(await apiFetch<CombinePage>(path, init, getToken));
      invalidate("/api/parties");
    } catch (e) {
      setError(failureText(e, fallback));
    } finally {
      setBusy(false);
    }
  }

  const propose = (pair: CombinePair, keep: CombineSide) => {
    const retire = keep === pair.mine ? pair.theirs : pair.mine;
    void act(
      COMBINE_KEY,
      {
        method: "POST",
        body: JSON.stringify({ keepPartyId: keep.partyId, retirePartyId: retire.partyId }),
      },
      "Couldn't send that. Try again.",
    );
  };
  const proposal = (id: string) => `${COMBINE_KEY}/${encodeURIComponent(id)}`;

  if (!page || page.pairs.length === 0) return null;

  return (
    <section className="character-group">
      <h2 className="character-world">Combine Parties</h2>
      {error && <p className="routine-error">{error}</p>}
      {page.pairs.map((pair) => {
        const kept = pair.proposal?.keepPartyId ?? null;
        return (
          <div key={`${pair.mine.partyId}-${pair.theirs.partyId}`} className="combine">
            <h3 className="combine-title ledger-who">
              {bossLabel(pair.boss, pair.mine.difficulty)}
              <span className="combine-with">
                <DiscordAvatar image={pair.friendImage} size="sm" />
                {pair.friend}
              </span>
            </h3>
            <div className="combine-pair">
              <Side title="Yours" side={pair.mine} kept={kept} />
              <Side title={pair.friend} side={pair.theirs} kept={kept} />
            </div>
            <p className="party-hint">Shared from {formatDropped(pair.sharedFrom)}</p>
            <div className="loot-actions">
              {pair.proposal === null &&
                [pair.mine, pair.theirs]
                  .filter((side) => pair.keepable.includes(side.partyId))
                  .map((side) => (
                    <button
                      key={side.partyId}
                      type="button"
                      className="party-save"
                      disabled={busy}
                      onClick={() => propose(pair, side)}
                    >
                      {side === pair.mine ? "Keep Yours" : `Keep ${pair.friend}'s`}
                    </button>
                  ))}
              {pair.proposal?.yours && (
                <>
                  <span className="party-hint">Waiting for {pair.friend}</span>
                  <button
                    type="button"
                    className="party-cancel"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        proposal(pair.proposal!.id),
                        { method: "DELETE" },
                        "Couldn't cancel it.",
                      )
                    }
                  >
                    Cancel Request
                  </button>
                </>
              )}
              {pair.proposal && !pair.proposal.yours && (
                <>
                  <button
                    type="button"
                    className="party-save"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        `${proposal(pair.proposal!.id)}/accept`,
                        { method: "POST" },
                        "Couldn't combine them.",
                      )
                    }
                  >
                    Combine
                  </button>
                  <button
                    type="button"
                    className="party-cancel"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        proposal(pair.proposal!.id),
                        { method: "DELETE" },
                        "Couldn't decline.",
                      )
                    }
                  >
                    Decline
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** One party: whose, its leader and roster, and whether the proposal keeps or retires it. */
function Side({ title, side, kept }: { title: string; side: CombineSide; kept: string | null }) {
  return (
    <div className="combine-side">
      <span className="tile-meta">
        {title}
        {kept !== null && (kept === side.partyId ? " · Kept" : " · Retired")}
      </span>
      <span className="tile-name">{side.leader}</span>
      <ul className="combine-members">
        {side.members.map((name) => (
          <li key={name}>{name}</li>
        ))}
      </ul>
    </div>
  );
}
