"use client";

import { useState } from "react";
import type { MemberRole, PartyMember } from "@/types/party";

// Who can reach a party you own: a role for each member who has joined, and an invite for each seat
// nobody has claimed. A seat whose character is nobody's on your People page is asked for first,
// because an invite is made for a person, and it carries every party they are in.
export function MemberRoles({
  seats,
  people,
  busy,
  inviting,
  onSet,
  onInvite,
}: {
  seats: PartyMember[];
  /** Your People page's names, offered when a seat's character is nobody's yet. */
  people: string[];
  busy: boolean;
  /** The seat whose link is being made. */
  inviting: string | null;
  onSet: (memberId: string, role: MemberRole) => void;
  /** Makes the link for whoever plays [seat], naming them [personName] when nobody does yet. */
  onInvite: (seat: PartyMember, personName: string | null) => void;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const [name, setName] = useState("");
  const joined = seats.filter((seat) => seat.role && !seat.guest);
  // Somebody else's character with no account behind it. Your own seats are you.
  const open = seats.filter((seat) => !seat.role && !seat.guest && seat.characterId === null);
  if (joined.length === 0 && open.length === 0) return null;
  return (
    <>
      <h4 className="loot-group-title is-config">Access</h4>
      <div className="loot-share-inputs">
        {joined.map((seat) => (
          <span key={seat.id} className="loot-share-input">
            <span className="loot-share-name">{seat.name}</span>
            <select
              className="split-input"
              value={seat.role ?? "VIEWER"}
              onChange={(e) => onSet(seat.id, e.target.value as MemberRole)}
              aria-label={`Access for ${seat.name}`}
              disabled={busy}
            >
              <option value="VIEWER">Viewer</option>
              <option value="EDITOR">Editor</option>
            </select>
          </span>
        ))}
        {open.map((seat) =>
          asking === seat.id ? (
            <form
              key={seat.id}
              className="loot-share-input"
              onSubmit={(e) => {
                e.preventDefault();
                if (!name.trim()) return;
                onInvite(seat, name.trim());
                setAsking(null);
              }}
            >
              <span className="loot-share-name">{`Who plays ${seat.name}?`}</span>
              <input
                className="split-input"
                value={name}
                list={`people-${seat.id}`}
                onChange={(e) => setName(e.target.value)}
                aria-label={`Who plays ${seat.name}`}
                maxLength={40}
                autoFocus
              />
              <datalist id={`people-${seat.id}`}>
                {people.map((p) => (
                  <option key={p} value={p} />
                ))}
              </datalist>
              <button type="submit" className="party-save" disabled={busy || !name.trim()}>
                Invite
              </button>
              <button type="button" className="party-cancel" onClick={() => setAsking(null)}>
                Cancel
              </button>
            </form>
          ) : (
            <span key={seat.id} className="loot-share-input">
              <span className="loot-share-name">{seat.name}</span>
              <button
                type="button"
                className="person-invite"
                disabled={busy || inviting !== null}
                onClick={() => {
                  if (seat.personId) {
                    onInvite(seat, null);
                  } else {
                    setName("");
                    setAsking(seat.id);
                  }
                }}
              >
                {inviting === seat.id ? "Generating..." : "Invite"}
              </button>
            </span>
          ),
        )}
      </div>
    </>
  );
}
