"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { ConfirmAct } from "@/components/confirm-act";
import { DiscordLookup, mayAsk, useDiscordLookup } from "@/components/discord-lookup";
import { PageSwap } from "@/components/page-swap";
import { type NavSection, SectionNav } from "@/components/section-nav";
import { SocialHead } from "@/components/social-head";
import { apiFetch, failureText, spriteUrl } from "@/lib/api";
import { invalidate } from "@/lib/cache";
import { friendsChanged, onFriendsChanged } from "@/lib/friends-changed";
import { reportDataReady } from "@/lib/rum";
import { useAuth } from "@/lib/use-auth";
import { useLive } from "@/lib/use-live";
import { bossLabel } from "@/lib/boss-difficulty";
import type { FriendView, IncomingInvite, SentInvite, Social } from "@/types/social";
import { DiscordAvatar } from "@/components/discord-avatar";

const SOCIAL_KEY = "/api/friends";
const INVITES_KEY = "/api/party-invites";
const SENT_INVITES_KEY = `${INVITES_KEY}/sent`;

// Friends: other accounts, found by Discord username. Requests to you and party invites are answered
// here or from the bell, so clearing one from the bell does not lose it. Accepting links the two
// accounts the way an invite does, so a friend is also a linked person on People and shares the
// parties that seat them.
export default function SocialPage() {
  const { getToken, isLoaded } = useAuth();
  const [social, setSocial] = useState<Social | null>(null);
  const [invites, setInvites] = useState<IncomingInvite[]>([]);
  const [sentInvites, setSentInvites] = useState<SentInvite[]>([]);
  const [failed, setFailed] = useState(false);
  const [username, setUsername] = useState("");
  const lookup = useDiscordLookup(username);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    return Promise.all([
      apiFetch<Social>(SOCIAL_KEY, { method: "GET" }, getToken).then(setSocial),
      apiFetch<IncomingInvite[]>(INVITES_KEY, { method: "GET" }, getToken).then(setInvites),
      apiFetch<SentInvite[]>(SENT_INVITES_KEY, { method: "GET" }, getToken).then(setSentInvites),
    ]);
  }

  /** Withdraws an invite you sent, then reads yours back. */
  async function cancelInvite(id: string) {
    setBusy(true);
    setError(null);
    try {
      await apiFetch<unknown>(
        `${INVITES_KEY}/${encodeURIComponent(id)}`,
        { method: "DELETE" },
        getToken,
      );
      // Party cards list their pending invites too.
      invalidate("/api/parties");
      setSentInvites(await apiFetch<SentInvite[]>(SENT_INVITES_KEY, { method: "GET" }, getToken));
    } catch (e) {
      setError(failureText(e, "Couldn't cancel."));
    } finally {
      setBusy(false);
    }
  }

  /** Accepts or declines a party invite, then reads the invites back. */
  async function answerInvite(id: string, accept: boolean) {
    setBusy(true);
    setError(null);
    try {
      const path = `${INVITES_KEY}/${encodeURIComponent(id)}`;
      await apiFetch<unknown>(
        accept ? `${path}/accept` : path,
        { method: accept ? "POST" : "DELETE" },
        getToken,
      );
      // A seat gained shows on Party View, Run Order and Sales.
      if (accept) invalidate("/api/parties");
      setInvites(await apiFetch<IncomingInvite[]>(INVITES_KEY, { method: "GET" }, getToken));
    } catch (e) {
      setError(failureText(e, accept ? "Couldn't join." : "Couldn't decline."));
    } finally {
      setBusy(false);
    }
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

  const incoming = social?.incoming ?? [];
  const outgoing = social?.outgoing ?? [];
  const pending = incoming.length + invites.length + outgoing.length + sentInvites.length;
  const sections: NavSection[] = [
    { id: "add", label: "Add Friend" },
    ...(pending > 0
      ? [{ id: "pending", label: "Pending", count: incoming.length + invites.length }]
      : []),
    { id: "friends", label: "Friends" },
  ];

  return (
    <main className="page">
      <SocialHead current="friends" />

      {failed && !social && <p>Couldn&apos;t load your friends. Reload to try again.</p>}
      <PageSwap waiting={!social && !failed} placeholder={<p className="party-hint">Loading...</p>}>
        {social && (
          <SectionNav sections={sections}>
            <FriendGroup id="add" title="Add Friend">
              {social.username && <p className="party-hint">You are @{social.username}</p>}
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
                <Button
                  variant="primary"
                  type="submit"
                  disabled={busy || !mayAsk(username, lookup)}
                >
                  Send Request
                </Button>
              </form>
              {error && <p className="routine-error">{error}</p>}
            </FriendGroup>

            {pending > 0 && (
              // What waits on you first, then what waits on them.
              <FriendGroup id="pending" title="Pending">
                <ul className="character-cards">
                  {incoming.map((f) => (
                    <FriendCard key={f.id} friend={f} kind="Friend request">
                      <Button
                        variant="primary"
                        disabled={busy}
                        onClick={() =>
                          void act(
                            `${request(f.id)}/accept`,
                            { method: "POST" },
                            "Couldn't accept.",
                          )
                        }
                      >
                        Accept
                      </Button>
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(request(f.id), { method: "DELETE" }, "Couldn't reject.")
                        }
                      >
                        Reject
                      </Button>
                    </FriendCard>
                  ))}
                  {invites.map((invite) => (
                    <li key={invite.id} className="character-card">
                      <span className="tile-plate">
                        <span className="tile-name">
                          {`${invite.leader}'s ${bossLabel(invite.boss, invite.difficulty)}`}
                        </span>
                        <span className="tile-meta">{`Party invite, as ${invite.character}`}</span>
                      </span>
                      <span className="character-card-actions">
                        <Button
                          variant="primary"
                          disabled={busy}
                          onClick={() => void answerInvite(invite.id, true)}
                        >
                          Accept
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void answerInvite(invite.id, false)}
                        >
                          Decline
                        </Button>
                      </span>
                    </li>
                  ))}
                  {outgoing.map((f) => (
                    <FriendCard key={f.id} friend={f} kind="Sent">
                      <Button
                        variant="secondary"
                        disabled={busy}
                        onClick={() =>
                          void act(request(f.id), { method: "DELETE" }, "Couldn't cancel.")
                        }
                      >
                        Cancel
                      </Button>
                    </FriendCard>
                  ))}
                  {sentInvites.map((invite) => (
                    <li key={invite.id} className="character-card">
                      <span className="tile-plate">
                        <span className="tile-name">
                          {`${invite.leader}'s ${bossLabel(invite.boss, invite.difficulty)}`}
                        </span>
                        <span className="tile-meta">{`Invite sent, to ${invite.character}`}</span>
                      </span>
                      <span className="character-card-actions">
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() => void cancelInvite(invite.id)}
                        >
                          Cancel
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </FriendGroup>
            )}

            <FriendGroup id="friends" title="Friends">
              {social.friends.length === 0 && <p className="finder-empty">No friends yet.</p>}
              <ul className="character-cards">
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
              </ul>
            </FriendGroup>
          </SectionNav>
        )}
      </PageSwap>
    </main>
  );
}

function FriendGroup({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="character-group social-section">
      <h2 className="character-world">
        <a href={`#${id}`}>{title}</a>
      </h2>
      {children}
    </section>
  );
}

/** Their main character's sprite, as a character card draws one, with the actions under it. */
function FriendCard({
  friend,
  kind,
  children,
}: {
  friend: FriendView;
  /** What a pending card is waiting on. */
  kind?: string;
  children: ReactNode;
}) {
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
        {kind && <span className="tile-meta">{kind}</span>}
      </span>
      <span className="character-card-actions">{children}</span>
    </li>
  );
}
