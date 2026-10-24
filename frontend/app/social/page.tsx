"use client";

import { type ReactNode, useEffect, useState } from "react";
import { CombineParties } from "@/components/combine-parties";
import { ConfirmAct } from "@/components/confirm-act";
import { DiscordLookup, mayAsk, useDiscordLookup } from "@/components/discord-lookup";
import { PageSwap } from "@/components/page-swap";
import { apiFetch, failureText, spriteUrl } from "@/lib/api";
import { invalidate } from "@/lib/cache";
import { friendsChanged, onFriendsChanged } from "@/lib/friends-changed";
import { reportDataReady } from "@/lib/rum";
import { useAuth } from "@/lib/use-auth";
import { useLive } from "@/lib/use-live";
import type { FriendView, Social } from "@/types/social";
import { DiscordAvatar } from "@/components/discord-avatar";

const SOCIAL_KEY = "/api/friends";

// Friends: other accounts, found by Discord username. Requests TO you are answered from the bell
// (NotificationBell). Accepting links the two accounts the way an
// invite does, so a friend is also a linked person on People and shares the parties that seat them.
export default function SocialPage() {
  const { getToken, isLoaded } = useAuth();
  const [social, setSocial] = useState<Social | null>(null);
  const [failed, setFailed] = useState(false);
  const [username, setUsername] = useState("");
  const lookup = useDiscordLookup(username);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    return apiFetch<Social>(SOCIAL_KEY, { method: "GET" }, getToken).then(setSocial);
  }

  useEffect(() => {
    // Not before auth answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    load()
      .then(() => reportDataReady())
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  // Something the other side did: a request answered, a friend removed.
  useLive(["friends", "notifications"], () => void load().catch(() => {}));

  // A request accepted from the bell is a new friend here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onFriendsChanged(() => void load().catch(() => {})), []);

  /** One write, answered with the whole page. A friendship changes people and parties as well. */
  async function act(path: string, init: RequestInit, fallback: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      setSocial(await apiFetch<Social>(path, init, getToken));
      invalidate("/api/people");
      invalidate("/api/parties");
      // Asking somebody who had asked you accepts them, which takes their request off the bell.
      friendsChanged();
      return true;
    } catch (e) {
      setError(failureText(e, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    const sent = await act(
      `${SOCIAL_KEY}/requests`,
      { method: "POST", body: JSON.stringify({ username: username.trim() }) },
      "Couldn't send that. Try again.",
    );
    if (sent) setUsername("");
  }

  const request = (id: string) => `${SOCIAL_KEY}/requests/${encodeURIComponent(id)}`;

  return (
    <main className="page">
      <div className="settings-section-head">
        <h1 className="page-title">Social</h1>
        {social?.username && <span className="party-hint">You are @{social.username}</span>}
      </div>

      {failed && !social && <p>Couldn&apos;t load your friends. Reload to try again.</p>}
      <PageSwap waiting={!social && !failed} placeholder={<p className="party-hint">Loading...</p>}>
        {social && (
          <>
            <form
              className="add-character social-add"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <DiscordLookup
                value={username}
                state={lookup}
                onChange={setUsername}
                disabled={busy}
              />
              <button
                type="submit"
                className="party-save"
                disabled={busy || !mayAsk(username, lookup)}
              >
                Send Request
              </button>
            </form>
            {error && <p className="routine-error">{error}</p>}

            <CombineParties />

            {social.outgoing.length > 0 && (
              <FriendGroup title="Sent">
                {social.outgoing.map((f) => (
                  <FriendCard key={f.id} friend={f}>
                    <button
                      type="button"
                      className="party-cancel"
                      disabled={busy}
                      onClick={() =>
                        void act(request(f.id), { method: "DELETE" }, "Couldn't cancel.")
                      }
                    >
                      Cancel
                    </button>
                  </FriendCard>
                ))}
              </FriendGroup>
            )}

            <FriendGroup title="Friends">
              {social.friends.length === 0 && <p className="finder-empty">No friends yet.</p>}
              {social.friends.map((f) => (
                <FriendCard key={f.id} friend={f}>
                  <ConfirmAct
                    label="Remove"
                    question="Remove Friend"
                    keep="Keep"
                    busy={busy}
                    onConfirm={() =>
                      void act(
                        `${SOCIAL_KEY}/${encodeURIComponent(f.id)}`,
                        { method: "DELETE" },
                        "Couldn't remove them.",
                      )
                    }
                  />
                </FriendCard>
              ))}
            </FriendGroup>
          </>
        )}
      </PageSwap>
    </main>
  );
}

function FriendGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="character-group">
      <h2 className="character-world">{title}</h2>
      <ul className="character-cards">{children}</ul>
    </section>
  );
}

/** Their main character's sprite, as a character card draws one, with the actions under it. */
function FriendCard({ friend, children }: { friend: FriendView; children: ReactNode }) {
  return (
    <li className="character-card">
      {friend.spriteImgUrl ? (
        <img className="tile-sprite" src={spriteUrl(friend.spriteImgUrl)} alt="" />
      ) : (
        <span className="tile-sprite" aria-hidden="true" />
      )}
      <span className="tile-plate">
        <span className="tile-name ledger-who">
          <DiscordAvatar image={friend.image} size="sm" />
          {friend.name ?? friend.username ?? "?"}
        </span>
        {friend.username && <span className="tile-meta">@{friend.username}</span>}
      </span>
      <span className="character-card-actions">{children}</span>
    </li>
  );
}
