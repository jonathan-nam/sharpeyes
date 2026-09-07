"use client";

import { KNOWN_CHARACTERS_ID } from "@/components/known-characters";
import { spriteUrl } from "@/lib/api";
import { MAX_PARTY } from "@/lib/parties";

// The OTHER seats in a party, as names you can type over. Your own character is the config, so it
// is not in here and the cap is one below the party limit.
//
// Shared by the edit page's per-character grid and by Party View's row. Seats are matched to
// existing rows by NAME (see writeMembers), so a typo does not rename a seat, it makes a new one
// and abandons the old: the datalist is what keeps that from happening, and both places get it.
export function RosterInputs({
  members,
  onChange,
  spriteFor,
  disabled = false,
}: {
  members: string[];
  onChange: (members: string[]) => void;
  /**
   * The sprite for a name as typed, backend-relative, or null for one we cannot draw.
   *
   * Optional: without it the boxes are text alone, which is what Party View's row still gets. A
   * typed name is matched exactly, so a half-typed one has no sprite until it is a whole name, and
   * that is the point. The frame filling in is what says the name landed on somebody real.
   */
  spriteFor?: (name: string) => string | null;
  /** A save is in flight, and what is typed into these boxes is about to be replaced by it. */
  disabled?: boolean;
}) {
  return (
    <div className={`config-members${spriteFor ? " has-sprites" : ""}`}>
      {members.map((member, index) => (
        // Positions in a list of text: there is nothing else to key on until it is saved.
        <span className="config-member" key={index}>
          {spriteFor && <MemberSprite sprite={spriteFor(member.trim())} />}
          <span className="config-member-box">
            <input
              className="split-input"
              value={member}
              list={KNOWN_CHARACTERS_ID}
              onChange={(e) => onChange(members.map((m, i) => (i === index ? e.target.value : m)))}
              placeholder="character"
              aria-label={`Member ${index + 1}`}
              maxLength={40}
              disabled={disabled}
            />
            {members.length > 1 && (
              <button
                type="button"
                className="grid-boss-remove"
                aria-label={`Remove member ${index + 1}`}
                disabled={disabled}
                onClick={() => onChange(members.filter((_, i) => i !== index))}
              >
                &times;
              </button>
            )}
          </span>
        </span>
      ))}
      {members.length < MAX_PARTY - 1 && (
        <button
          type="button"
          className="party-add-seat"
          disabled={disabled}
          onClick={() => onChange([...members, ""])}
        >
          + Member
        </button>
      )}
    </div>
  );
}

/**
 * Who a box has landed on, above the box.
 *
 * The frame is drawn either way, so a roster does not jump about as each name resolves and the
 * boxes stay in a line. Empty is the ordinary state of a seat being typed, so it is a plain
 * recess and not the dashed "missing" frame RosterStrip draws: there, every name is saved and one
 * without a sprite really is a character nobody could find.
 */
function MemberSprite({ sprite }: { sprite: string | null }) {
  return sprite ? (
    <img className="member-sprite" src={spriteUrl(sprite)} alt="" />
  ) : (
    <span className="member-sprite is-empty" aria-hidden="true" />
  );
}
