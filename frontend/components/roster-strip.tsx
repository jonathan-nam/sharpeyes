"use client";

import { Tooltip } from "@/components/tooltip";
import { spriteUrl } from "@/lib/api";
import type { PartyMember } from "@/types/party";

// The people in a party, as the sprites they are.
//
// A row of names told you who was in it; a row of characters tells you at a glance, which is the
// whole reason the sprites were fetched. Same tile shape as the clear matrix's column heads, so a
// character reads the same on both pages.
export function RosterStrip({ members }: { members: PartyMember[] }) {
  return (
    <ul className="roster-strip">
      {members.map((member) => (
        <Tooltip
          key={member.id}
          text={member.characterId ? "One of your characters" : member.personName}
        >
          <li className={`roster-tile${member.characterId ? " is-mine" : ""}`}>
            {member.spriteImgUrl ? (
              <img className="roster-sprite" src={spriteUrl(member.spriteImgUrl)} alt="" />
            ) : (
              // The lookup found nothing, or has not run. The frame is drawn anyway so a party of
              // five does not go ragged around the one character nobody could find.
              <span className="roster-sprite is-empty" aria-hidden="true" />
            )}
            <span className="roster-name">{member.name}</span>
            {/* Whose character it is, or that they are not usually in this party. Never both: the
              tile has one line under the name, and which of the two matters is whichever one is
              unexpected. A guest you have not attributed is still marked. */}
            {member.guest ? (
              <span className="roster-guest">guest</span>
            ) : (
              member.personName && <span className="roster-person">{member.personName}</span>
            )}
          </li>
        </Tooltip>
      ))}
    </ul>
  );
}
