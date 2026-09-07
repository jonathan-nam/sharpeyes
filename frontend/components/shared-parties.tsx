import { useState } from "react";
import { clearClass, clearStateLabel } from "@/lib/boss-clears";
import { difficultyLabel } from "@/lib/boss-difficulty";
import { formatMesos } from "@/lib/drop-split";
import { formatDropped, statusLabel } from "@/lib/loot";
import { bySeatedCharacter, yourShare } from "@/lib/shared-parties";
import type { Boss } from "@/types/boss";
import type { SeatedParty } from "@/types/party";

// The parties somebody else keeps the book for, and the nights of them you were on.
//
// One control, and it is about your own seat. The pool is theirs to record, so a member who wants a
// night changed still asks the person who logged it; leaving is the one thing here nobody else can
// answer for you. Every other write would go into their pool, where two people logging one night is
// a double count.

export function SharedParties({
  parties,
  bosses,
  characterOrder,
  clearOf,
  onLeave,
  isSaving,
  leaveError,
}: {
  parties: SeatedParty[];
  bosses: Boss[];
  /**
   * Your characters' ids, in the order your own parties are listed in.
   *
   * So the two lists read down the page the same way. Order only: which character a party belongs
   * under is the seat's answer, not this list's, and a character missing from it costs a position
   * rather than a party.
   */
  characterOrder: string[];
  /**
   * Whether YOUR character has cleared this party's boss this period.
   *
   * Your own account's answer, not the owner's. boss_clear is per character, so the owner's tick is
   * about THEIR character and answers "have they run it", where the question on this card is "have
   * I". Both accounts record the same night, once each, because the run is one run.
   *
   * Passed in rather than resolved here: the page already holds the clears and already has one way
   * of reading them, and a second way is how two screens come to disagree about the same tick.
   */
  clearOf: (party: SeatedParty) => boolean | null;
  /** Takes this account's seat out of a party it does not own. */
  onLeave: (party: SeatedParty) => void;
  /** Keyed by party id, the way the owner's own cards are. */
  isSaving: (key: string) => boolean;
  /** The server's own reason, kept with the party it was about. */
  leaveError: { partyId: string; message: string } | null;
}) {
  if (parties.length === 0) return null;
  const nameOf = (bossKey: string) => bosses.find((b) => b.bossKey === bossKey)?.name ?? bossKey;
  const groups = bySeatedCharacter(parties, characterOrder);
  return (
    <section className="party-group">
      {/* The banner stays the section's, not a character's. Under headings that are only names,
          somebody else's parties would read as your own. */}
      <header className="party-banner">
        <h2 className="party-group-name">Shared with you</h2>
      </header>
      {groups.map((group) => (
        <div className="shared-group" key={group.characterId ?? group.name}>
          {/* The lighter head the by-boss list uses, not a second banner: one 96px sprite row
              inside another is two things claiming to be the subject. */}
          <header className="party-group-head">
            <h3 className="party-group-name">{group.name}</h3>
            <span className="party-banner-count">
              {group.parties.length} {group.parties.length === 1 ? "party" : "parties"}
            </span>
          </header>
          {group.parties.map((party) => (
            <div className="shared-party" key={party.id}>
              <h3 className="config-boss">
                {nameOf(party.bossKey)}
                {party.difficulty && (
                  <span className="party-difficulty">{difficultyLabel(party.difficulty)}</span>
                )}
                {/* Read-only, like a past week's. Your clear is yours to change, but not from a card
                about somebody else's party: it is on your own routine and the Boss Clears page. */}
                <span className={`party-clear is-${clearClass(clearOf(party))} is-readonly`}>
                  {clearStateLabel(clearOf(party))}
                </span>
              </h3>
              {/* The roster as its owner keeps it, yours among them. */}
              <p className="party-hint">{party.seats.map((seat) => seat.name).join(", ")}</p>
              {party.nights.length === 0 ? (
                // Not "no drops": the pool may hold plenty, from weeks this account was not on.
                <p className="finder-empty">Nothing on your nights yet.</p>
              ) : (
                <ul className="shared-nights">
                  {party.nights.map((night) => {
                    const mine = yourShare(night, party);
                    return (
                      <li key={night.id}>
                        <span className="shared-night-drop">
                          {night.name}
                          {night.quantity > 1 && ` x${night.quantity}`}
                        </span>
                        <span className="shared-night-when">{formatDropped(night.droppedOn)}</span>
                        {/* Their word for the drop's stage, then yours for your own share of it: a pool
                        can be Awaiting payout while your seat is already settled. */}
                        <span className="shared-night-status">{statusLabel(night.status)}</span>
                        {/* What the party got for it, so your own figure below can be checked against
                        something rather than taken on trust. */}
                        {night.saleAmount !== null && (
                          <span className="shared-night-sold">{formatMesos(night.saleAmount)}</span>
                        )}
                        {mine && (
                          <span className="shared-night-yours">
                            You: {formatMesos(mine.nets)} {mine.paid ? "paid" : "owed"}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <LeaveSeat
                boss={nameOf(party.bossKey)}
                onLeave={() => onLeave(party)}
                saving={isSaving(party.id)}
                error={leaveError?.partyId === party.id ? leaveError.message : null}
              />
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}

/**
 * Leaving, in two presses.
 *
 * Confirmed rather than done on the first click: it edits somebody else's roster, and this account
 * cannot put itself back afterwards, only the owner can. The boss is named in the question because
 * the button sits on one card among however many the page is showing.
 */
function LeaveSeat({
  boss,
  onLeave,
  saving,
  error,
}: {
  boss: string;
  onLeave: () => void;
  saving: boolean;
  error: string | null;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <p className="shared-party-act">
      {confirming ? (
        <>
          <button type="button" className="party-delete" onClick={onLeave} disabled={saving}>
            Leave {boss}?
          </button>
          <button
            type="button"
            className="party-cancel"
            onClick={() => setConfirming(false)}
            disabled={saving}
          >
            Stay
          </button>
        </>
      ) : (
        <button
          type="button"
          className="party-delete"
          onClick={() => setConfirming(true)}
          disabled={saving}
        >
          Leave
        </button>
      )}
      {error && <span className="split-error">{error}</span>}
    </p>
  );
}
