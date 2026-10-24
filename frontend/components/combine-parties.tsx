"use client";

import { useEffect, useState } from "react";
import { DiscordAvatar } from "@/components/discord-avatar";
import { apiFetch, failureText, spriteUrl } from "@/lib/api";
import { difficultyLabel } from "@/lib/boss-difficulty";
import { invalidate } from "@/lib/cache";
import { onFriendsChanged } from "@/lib/friends-changed";
import { formatDropped } from "@/lib/loot";
import { useAuth } from "@/lib/use-auth";
import { useLive } from "@/lib/use-live";
import type {
  CombineConflict,
  CombinePage,
  CombineSide,
  CombineWith,
  SeatClash,
} from "@/types/combine";

const COMBINE_KEY = "/api/party-combines";

// Social's Combine Parties. A combine is a merge: the sender settles the conflicts, matching pairs
// settle themselves, and the friend accepts or declines the whole request. Drops before the shared
// date stay in each owner's own book. See backend CombineParties.kt.
export function CombineParties() {
  const { getToken, isLoaded } = useAuth();
  const [page, setPage] = useState<CombinePage | null>(null);
  const [open, setOpen] = useState<string | null>(null);
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

  // The friend asked, answered, or changed a roster; a new friend can bring matches.
  useLive(["notifications", "party", "friends"], () => void load());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => onFriendsChanged(() => void load()), []);

  async function act(path: string, init: RequestInit, fallback: string): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      setPage(await apiFetch<CombinePage>(path, init, getToken));
      invalidate("/api/parties");
      return true;
    } catch (e) {
      setError(failureText(e, fallback));
      return false;
    } finally {
      setBusy(false);
    }
  }

  const request = (id: string) => `${COMBINE_KEY}/${encodeURIComponent(id)}`;

  if (!page || (page.friends.length === 0 && page.incoming.length === 0)) return null;

  return (
    <section className="character-group">
      <h2 className="character-world">Combine Parties</h2>
      {error && <p className="routine-error">{error}</p>}
      <div className="combine-list">
        {page.incoming.map((r) => (
          <div key={r.id} className="combine-row">
            <span className="combine-who">
              <DiscordAvatar image={r.friendImage} size="sm" />
              {r.friend} wants to combine {r.total} {r.total === 1 ? "party" : "parties"}
            </span>
            <span className="party-hint">
              {keeps([
                [`${r.friend}'s`, r.keepsTheirs],
                ["yours", r.keepsYours],
              ])}
            </span>
            {(r.takesOut ?? []).map((s) => (
              <span key={`${s.name}:${s.leader}`} className="party-hint combine-takes">
                Takes {s.name} out of your {s.boss} ({s.leader})
              </span>
            ))}
            <span className="combine-actions">
              <button
                type="button"
                className="party-save"
                disabled={busy}
                onClick={() =>
                  void act(`${request(r.id)}/accept`, { method: "POST" }, "Couldn't combine them.")
                }
              >
                Combine
              </button>
              <button
                type="button"
                className="party-cancel"
                disabled={busy}
                onClick={() => void act(request(r.id), { method: "DELETE" }, "Couldn't decline.")}
              >
                Decline
              </button>
            </span>
          </div>
        ))}
        {page.friends.map((f) => (
          <div key={f.personId} className="combine-row">
            <span className="combine-who">
              <DiscordAvatar image={f.friendImage} size="sm" />
              {f.friend}
            </span>
            <span className="party-hint">
              {f.matched} matching {f.matched === 1 ? "party" : "parties"}
              {f.conflicts.length > 0 && ` · ${f.conflicts.length} to resolve`}
            </span>
            <span className="combine-actions">
              {f.sentRequestId ? (
                <>
                  <span className="party-hint">Waiting for {f.friend}</span>
                  <button
                    type="button"
                    className="party-cancel"
                    disabled={busy}
                    onClick={() =>
                      void act(
                        request(f.sentRequestId!),
                        { method: "DELETE" },
                        "Couldn't cancel it.",
                      )
                    }
                  >
                    Cancel Request
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="party-save"
                  disabled={busy}
                  aria-expanded={open === f.personId}
                  onClick={() => setOpen(open === f.personId ? null : f.personId)}
                >
                  Combine Parties
                </button>
              )}
            </span>
            {open === f.personId && !f.sentRequestId && (
              <Merge
                key={f.personId}
                friend={f}
                busy={busy}
                preview={(choices) =>
                  apiFetch<{ clashes: SeatClash[] }>(
                    `${COMBINE_KEY}/preview`,
                    { method: "POST", body: JSON.stringify({ personId: f.personId, choices }) },
                    getToken,
                  ).then((r) => r.clashes)
                }
                onSend={async (choices, seats) => {
                  const sent = await act(
                    COMBINE_KEY,
                    {
                      method: "POST",
                      body: JSON.stringify({ personId: f.personId, choices, seats }),
                    },
                    "Couldn't send that. Try again.",
                  );
                  if (sent) setOpen(null);
                }}
              />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** "Keeps Bro's for 16, yours for 2", leaving out a side with none. */
function keeps(parts: [string, number][]): string {
  return `Keeps ${parts
    .filter(([, n]) => n > 0)
    .map(([whose, n]) => `${whose} for ${n}`)
    .join(", ")}`;
}

type Choice = { mine: string; theirs: string; keepPartyId: string };
type Seat = { name: string; keepPartyId: string };

/**
 * The sender's side: what settles itself, every conflict with a party to keep, then every character
 * the chosen merges would still leave in two parties, since a character clears a boss once a week.
 */
function Merge({
  friend,
  busy,
  preview,
  onSend,
}: {
  friend: CombineWith;
  busy: boolean;
  /** The characters left to place for these choices. Asked of the server, which owns the rule. */
  preview: (choices: Choice[]) => Promise<SeatClash[]>;
  onSend: (choices: Choice[], seats: Seat[]) => void;
}) {
  // Per conflict, by its two party ids: the party id to keep.
  const [answers, setAnswers] = useState<Record<string, string>>({});
  // Per character left in two parties, by lowercased name: the party id that keeps them.
  const [seats, setSeats] = useState<Record<string, string>>({});
  // The server's answer, with the choices it answered: a stale one is not shown.
  const [previewed, setPreviewed] = useState<{ asked: string; open: SeatClash[] } | null>(null);
  const keyOf = (c: CombineConflict) => `${c.mine.partyId}:${c.theirs.partyId}`;
  const answered = friend.conflicts.every((c) => answers[keyOf(c)] !== undefined);
  const settled = friend.keepsYours + friend.keepsTheirs;
  const choices: Choice[] = friend.conflicts.flatMap((c) => {
    const keepPartyId = answers[keyOf(c)];
    return keepPartyId ? [{ mine: c.mine.partyId, theirs: c.theirs.partyId, keepPartyId }] : [];
  });
  // Which characters are left depends on which side each pair keeps, so it is asked again per change.
  const asked = JSON.stringify(choices);
  const clashes = answered && previewed?.asked === asked ? previewed.open : null;
  const placed = clashes?.every((s) => seats[s.name.toLowerCase()] !== undefined) ?? false;

  useEffect(() => {
    if (!answered) return;
    let live = true;
    preview(choices)
      .then((open) => live && setPreviewed({ asked, open }))
      .catch(() => {});
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asked, answered]);

  return (
    <div className="combine-merge">
      {settled > 0 && (
        <p className="party-hint">
          {settled} match as they are.{" "}
          {keeps([
            ["yours", friend.keepsYours],
            [`${friend.friend}'s`, friend.keepsTheirs],
          ])}
          .
        </p>
      )}
      {friend.conflicts.map((c) => (
        <fieldset key={keyOf(c)} className="combine">
          <legend className="combine-title">{c.boss}</legend>
          <div className="combine-pair">
            <Side title="Yours" side={c.mine} other={c.theirs} />
            <Side title={friend.friend} side={c.theirs} other={c.mine} />
          </div>
          <div className="combine-choices" role="radiogroup">
            {[
              { id: c.mine.partyId, label: "Keep Yours" },
              { id: c.theirs.partyId, label: `Keep ${friend.friend}'s` },
            ]
              .filter((o) => c.keepable.includes(o.id))
              .map((o) => (
                <label key={o.id} className="combine-choice">
                  <input
                    type="radio"
                    name={keyOf(c)}
                    checked={answers[keyOf(c)] === o.id}
                    onChange={() => setAnswers({ ...answers, [keyOf(c)]: o.id })}
                  />
                  {o.label}
                </label>
              ))}
          </div>
          <p className="party-hint">Shared from {formatDropped(c.sharedFrom)}</p>
        </fieldset>
      ))}
      {clashes?.map((s) => (
        <fieldset key={s.name} className="combine">
          <legend className="combine-title">
            {s.name} · {s.boss}
          </legend>
          <div className="combine-clash">
            {s.sprite ? (
              <img className="seat-sprite" src={spriteUrl(s.sprite)} alt="" />
            ) : (
              <span className="seat-sprite is-empty" aria-hidden="true" />
            )}
            <div className="combine-choices" role="radiogroup">
              {s.options.map((o) => (
                <label key={o.partyId} className="combine-choice">
                  <input
                    type="radio"
                    name={`seat:${s.name}`}
                    checked={seats[s.name.toLowerCase()] === o.partyId}
                    onChange={() => setSeats({ ...seats, [s.name.toLowerCase()]: o.partyId })}
                  />
                  Keep in {o.yours ? "Yours" : `${friend.friend}'s`} ({o.leader})
                </label>
              ))}
            </div>
          </div>
        </fieldset>
      ))}
      <div className="loot-actions">
        <button
          type="button"
          className="party-save"
          disabled={busy || !answered || !placed}
          onClick={() =>
            onSend(
              choices,
              (clashes ?? []).flatMap((s) => {
                const keepPartyId = seats[s.name.toLowerCase()];
                return keepPartyId ? [{ name: s.name, keepPartyId }] : [];
              }),
            )
          }
        >
          Send Request
        </button>
      </div>
    </div>
  );
}

/** One party of a conflict, as its seats. A seat the other party lacks is marked. */
function Side({ title, side, other }: { title: string; side: CombineSide; other: CombineSide }) {
  const theirs = new Set(other.members.map((m) => m.name.toLowerCase()));
  return (
    <div className="combine-side">
      <span className="tile-meta">
        {title}
        {side.difficulty && (
          <>
            {" · "}
            <span className={side.difficulty === other.difficulty ? undefined : "is-only-here"}>
              {difficultyLabel(side.difficulty)}
            </span>
          </>
        )}
      </span>
      <ul className="combine-faces">
        {side.members.map((m) => (
          <li
            key={m.name}
            className={theirs.has(m.name.toLowerCase()) ? undefined : "is-only-here"}
          >
            {m.sprite ? (
              <img className="seat-sprite" src={spriteUrl(m.sprite)} alt="" />
            ) : (
              <span className="seat-sprite is-empty" aria-hidden="true" />
            )}
            <span className="tile-name">{m.name}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
