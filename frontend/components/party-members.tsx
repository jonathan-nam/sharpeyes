"use client";

import { useState } from "react";
import { Button } from "@/components/button";
import { ConfirmAct } from "@/components/confirm-act";
import type { PartyMember } from "@/types/party";

// The members of a party you own, apart from your own seats: an invite for each seat no account has
// claimed yet, and a way to take any of them out. A seat whose character is nobody's on your People
// page is asked for first, because an invite is made for a person, and it carries every party they
// are in. Whoever joins may log drops and record sales as their seat.
export function PartyMembers({
  seats,
  people,
  busy,
  inviting,
  onInvite,
  onRemove,
}: {
  seats: PartyMember[];
  /** Your People page's names, offered when a seat's character is nobody's yet. */
  people: string[];
  busy: boolean;
  /** The seat whose link is being made. */
  inviting: string | null;
  /** Makes the link for whoever plays [seat], naming them [personName] when nobody does yet. */
  onInvite: (seat: PartyMember, personName: string | null) => void;
  /** Takes the seat out, the way the member leaving would. */
  onRemove: (memberId: string) => void;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const [name, setName] = useState("");
  // Everybody else's seats. Your own are you, and a guest is one week's, not the party's.
  const open = seats.filter((seat) => !seat.guest && seat.characterId === null);
  if (open.length === 0) return null;
  return (
    <>
      <h4 className="loot-group-title is-config">Members</h4>
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
              <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
                Invite
              </Button>
              <Button variant="secondary" onClick={() => setAsking(null)}>
                Cancel
              </Button>
            </form>
          ) : (
            <span key={seat.id} className="loot-share-input">
              <span className="loot-share-name">{seat.name}</span>
              {seat.linkedCharacterId ? (
                <span className="party-hint">Joined</span>
              ) : (
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
              )}
              <ConfirmAct
                label="Remove"
                question={`Remove ${seat.name}?`}
                keep="Keep"
                busy={busy}
                onConfirm={() => onRemove(seat.id)}
              />
            </span>
          ),
        )}
      </div>
    </>
  );
}
