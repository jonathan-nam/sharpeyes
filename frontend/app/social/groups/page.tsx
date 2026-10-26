"use client";

import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/button";
import { ConfirmAct } from "@/components/confirm-act";
import { DiscordAvatar } from "@/components/discord-avatar";
import { PageSwap } from "@/components/page-swap";
import { type NavSection, SectionNav } from "@/components/section-nav";
import { SocialHead } from "@/components/social-head";
import { apiFetch, failureText, spriteUrl } from "@/lib/api";
import { GROUPS_KEY } from "@/lib/groups";
import { reportDataReady } from "@/lib/rum";
import { useAuth } from "@/lib/use-auth";
import { useLive } from "@/lib/use-live";
import type { Group, GroupMember, Groups } from "@/types/groups";

const MAX_NAME = 40;

// Groups: people who add each other's characters to parties without an invite. Everybody else is
// still invited. Joining is by invite, and only somebody friends with every member can be invited,
// so the picker lists only them. See backend Groups.kt.
export default function GroupsPage() {
  const { getToken, isLoaded } = useAuth();
  const [page, setPage] = useState<Groups | null>(null);
  const [failed, setFailed] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    return apiFetch<Groups>(GROUPS_KEY, { method: "GET" }, getToken).then(setPage);
  }

  useEffect(() => {
    // Not before auth answers, or the fetch goes out as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    load()
      .then(() => reportDataReady())
      .catch(() => setFailed(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  // A groupmate joined, left or invited somebody.
  useLive(["friends", "notifications"], () => void load().catch(() => {}));

  /** One write, answered with the whole page. */
  async function act(path: string, init: RequestInit, fallback: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      setPage(await apiFetch<Groups>(path, init, getToken));
      return true;
    } catch (e) {
      setError(failureText(e, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const made = await act(
      GROUPS_KEY,
      { method: "POST", body: JSON.stringify({ name: name.trim() }) },
      "Couldn't create the group.",
    );
    if (made) setName("");
  }

  const invite = (id: string) => `${GROUPS_KEY}/invites/${encodeURIComponent(id)}`;
  const group = (id: string) => `${GROUPS_KEY}/${encodeURIComponent(id)}`;

  const invites = page?.invites ?? [];
  const sections: NavSection[] = [
    { id: "new", label: "New Group" },
    ...(invites.length > 0 ? [{ id: "invites", label: "Invites", count: invites.length }] : []),
    ...(page?.groups ?? []).map((g) => ({ id: `group-${g.id}`, label: g.name })),
  ];

  return (
    <main className="page">
      <SocialHead current="groups" />

      {failed && !page && <p>Couldn&apos;t load your groups. Reload to try again.</p>}
      <PageSwap waiting={!page && !failed} placeholder={<p className="party-hint">Loading...</p>}>
        {page && (
          <SectionNav sections={sections}>
            <Section id="new" title="New Group">
              <form
                className="add-character social-add"
                onSubmit={(e) => {
                  e.preventDefault();
                  void create();
                }}
              >
                <input
                  type="text"
                  className="split-input"
                  value={name}
                  maxLength={MAX_NAME}
                  placeholder="Group name"
                  aria-label="Group name"
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                />
                <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
                  Create Group
                </Button>
              </form>
              {error && <p className="routine-error">{error}</p>}
              {page.groups.length === 0 && <p className="finder-empty">No groups yet.</p>}
            </Section>

            {invites.length > 0 && (
              <Section id="invites" title="Invites">
                <ul className="character-cards">
                  {invites.map((i) => (
                    <li key={i.id} className="character-card">
                      <span className="tile-plate">
                        <span className="tile-name">{i.group}</span>
                        <span className="tile-meta">
                          {`${i.members} ${i.members === 1 ? "member" : "members"}`}
                          {i.from ? `, from ${i.from}` : ""}
                        </span>
                      </span>
                      <span className="character-card-actions">
                        <Button
                          variant="primary"
                          disabled={busy}
                          onClick={() =>
                            void act(`${invite(i.id)}/accept`, { method: "POST" }, "Couldn't join.")
                          }
                        >
                          Join
                        </Button>
                        <Button
                          variant="secondary"
                          disabled={busy}
                          onClick={() =>
                            void act(invite(i.id), { method: "DELETE" }, "Couldn't decline.")
                          }
                        >
                          Decline
                        </Button>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            )}

            {page.groups.map((g) => (
              <GroupSection
                key={g.id}
                group={g}
                busy={busy}
                onInvite={(personId) =>
                  void act(
                    `${group(g.id)}/invites`,
                    { method: "POST", body: JSON.stringify({ personId }) },
                    "Couldn't invite them.",
                  )
                }
                onCancel={(id) => void act(invite(id), { method: "DELETE" }, "Couldn't cancel.")}
                onLeave={() =>
                  void act(`${group(g.id)}/membership`, { method: "DELETE" }, "Couldn't leave.")
                }
              />
            ))}
          </SectionNav>
        )}
      </PageSwap>
    </main>
  );
}

function GroupSection({
  group,
  busy,
  onInvite,
  onCancel,
  onLeave,
}: {
  group: Group;
  busy: boolean;
  onInvite: (personId: string) => void;
  onCancel: (inviteId: string) => void;
  onLeave: () => void;
}) {
  const [chosen, setChosen] = useState("");

  return (
    <Section id={`group-${group.id}`} title={group.name}>
      <ul className="character-cards">
        {group.members.map((m, i) => (
          <MemberCard
            key={`m${i}`}
            member={m}
            kind={m.you ? "You" : m.friend ? undefined : "Not friends"}
          />
        ))}
        {group.invited.map((i) => (
          <MemberCard key={i.id} member={i.member} kind="Invited">
            <Button variant="secondary" disabled={busy} onClick={() => onCancel(i.id)}>
              Cancel
            </Button>
          </MemberCard>
        ))}
      </ul>

      <div className="add-character">
        {group.invitable.length > 0 && (
          <form
            className="add-character"
            onSubmit={(e) => {
              e.preventDefault();
              if (chosen) onInvite(chosen);
              setChosen("");
            }}
          >
            <select
              className="split-input"
              value={chosen}
              aria-label="Friend to invite"
              disabled={busy}
              onChange={(e) => setChosen(e.target.value)}
            >
              <option value="">Choose a friend</option>
              {group.invitable.map((f) => (
                <option key={f.personId} value={f.personId}>
                  {f.name}
                </option>
              ))}
            </select>
            <Button variant="primary" type="submit" disabled={busy || !chosen}>
              Invite
            </Button>
          </form>
        )}
        <ConfirmAct
          label="Leave"
          question="Leave Group"
          keep="Stay"
          busy={busy}
          onConfirm={onLeave}
        />
      </div>
    </Section>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="character-group social-section">
      <h2 className="character-world">
        <a href={`#${id}`}>{title}</a>
      </h2>
      {children}
    </section>
  );
}

/** A member's main character sprite and Discord face, as Friends draws a friend. */
function MemberCard({
  member,
  kind,
  children,
}: {
  member: GroupMember;
  kind?: string;
  children?: ReactNode;
}) {
  return (
    <li className="character-card">
      {member.spriteImgUrl ? (
        <img className="tile-sprite" src={spriteUrl(member.spriteImgUrl)} alt="" />
      ) : (
        <span className="tile-sprite" aria-hidden="true" />
      )}
      <span className="tile-plate">
        <span className="tile-name ledger-who">
          <DiscordAvatar image={member.image} size="sm" />
          {member.name ?? member.username ?? "?"}
        </span>
        {member.username && <span className="tile-meta">@{member.username}</span>}
        {kind && <span className="tile-meta">{kind}</span>}
      </span>
      <span className="character-card-actions">{children}</span>
    </li>
  );
}
