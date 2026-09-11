import { PartyCard } from "@/components/party-card";
import { apiAssetUrl } from "@/lib/api";
import { bossLabel } from "@/lib/boss-difficulty";
import { NOTHING_OUTSTANDING } from "@/lib/loot";
import { bySeatedCharacter } from "@/lib/shared-parties";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { SeatedParty } from "@/types/party";

// The parties somebody else keeps the book for, filed under the character of yours in them.
//
// The same card as your own, with none of its writes: the pool is theirs to record, so a member who
// wants a night changed asks the person who logged it. What the card still does is link to the
// party's own page, which is where a member reads the pool and where leaving is.

export function SharedParties({
  parties,
  bosses,
  characters,
}: {
  parties: SeatedParty[];
  bosses: Boss[];
  /** Yours, for the headings and for the order the groups come out in. */
  characters: Character[];
}) {
  if (parties.length === 0) return null;
  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const nameOf = (characterId: string) =>
    characters.find((c) => c.id === characterId)?.name ?? "Your characters";
  const groups = bySeatedCharacter(
    parties,
    characters.map((c) => c.id),
  );
  return (
    <section className="party-group">
      {/* The banner stays the section's, not a character's. Under headings that are only names,
          somebody else's parties would read as your own. */}
      <header className="party-banner">
        <h2 className="party-group-name">Shared with you</h2>
      </header>
      {groups.map((group) => (
        <div className="shared-group" key={group.characterId}>
          {/* The lighter head the by-boss list uses, not a second banner: one 96px sprite row
              inside another is two things claiming to be the subject. */}
          <header className="party-group-head">
            <h3 className="party-group-name">{nameOf(group.characterId)}</h3>
            <span className="party-banner-count">
              {group.parties.length} {group.parties.length === 1 ? "party" : "parties"}
            </span>
          </header>
          {group.parties.map(({ party }) => {
            const boss = bossByKey.get(party.bossKey);
            return (
              <PartyCard
                key={party.id}
                party={party}
                clear={{ cleared: party.cleared, byHand: party.clearedByHand }}
                // Coupons owed are reckoned over your own account's pools and this one is not in
                // them, so this account has nothing to say. Absent, rather than a badge claiming
                // none are outstanding.
                coupons={NOTHING_OUTSTANDING}
                // No pool panel and no callbacks. Every write on this party is its owner's, and the
                // drops themselves are on its own page: /api/parties/loot is your own parties, so a
                // panel here would draw an empty pool under a row that says what is in it.
                heading={
                  <>
                    {boss?.iconUrl && (
                      <img className="boss-portrait" src={apiAssetUrl(boss.iconUrl)} alt="" />
                    )}
                    <h3 className="party-row-name">
                      {bossLabel(boss?.name ?? party.bossKey, party.difficulty)}
                    </h3>
                  </>
                }
              />
            );
          })}
        </div>
      ))}
    </section>
  );
}
