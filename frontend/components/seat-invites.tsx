"use client";

import { useState } from "react";
import type { PartyMember } from "@/types/party";

// An invite for each seat of a party you own that no account has claimed yet. A seat whose character
// is nobody's on your People page is asked for first, because an invite is made for a person, and
// it carries every party they are in. Whoever joins may log drops and record sales as their seat.
export function SeatInvites({
  seats,
  people,
  busy,
  inviting,
  onInvite,
}: {
  seats: PartyMember[];
  /** Your People page's names, offered when a seat's character is nobody's yet. */
  people: string[];
  busy: boolean;
  /** The seat whose link is being made. */
  inviting: string | null;
  /** Makes the link for whoever plays [seat], naming them [personName] when nobody does yet. */
  onInvite: (seat: PartyMember, personName: string | null) => void;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const [name, setName] = useState("");
  // Somebody else's character with no account behind it. Your own seats are you, and a seat with a
  // linked character has joined already.
  const open = seats.filter(
    (seat) => !seat.guest && seat.characterId === null && seat.linkedCharacterId === null,
  );
  if (open.length === 0) return null;
  return (
    <>
      <h4 className="loot-group-title is-config">Invite</h4>
      <div className="loot-share-inputs">
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
