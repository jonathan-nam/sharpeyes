import Link from "next/link";
import { clearClass, clearStateLabel } from "@/lib/boss-clears";
import { difficultyLabel } from "@/lib/boss-difficulty";
import { formatMoney } from "@/lib/money";
import { formatDropped, saleMoney, statusLabel } from "@/lib/loot";
import { bySeatedCharacter, yourShare } from "@/lib/shared-parties";
import type { Boss } from "@/types/boss";
import type { SeatedParty } from "@/types/party";

// The parties somebody else keeps the book for, and the nights of them you were on.
//
// No controls. The pool is theirs to record, so a member who wants a night changed asks the person
// who logged it, and leaving is on the party's own page with everything else about it.

export function SharedParties({
  parties,
  bosses,
  characterOrder,
  clearOf,
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
                {/* By id, not by a slug: a slug names the OWNER's character, and this account has
                    no name for it. See partySlug. */}
                <Link href={`/bosses/parties/${party.id}`}>{nameOf(party.bossKey)}</Link>
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
                    // The party's figure in the night's own unit, which is the sale's. See saleMoney.
                    const sold = saleMoney(night);
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
                        {sold !== null && (
                          <span className="shared-night-sold">
                            {formatMoney(sold.amount, sold.currency)}
                          </span>
                        )}
                        {mine && (
                          <span className="shared-night-yours">
                            You: {formatMoney(mine.nets, mine.currency)}{" "}
                            {mine.paid ? "paid" : "owed"}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
