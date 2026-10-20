"use client";

import type { MemberRole, PartyMember } from "@/types/party";

// Who may record in a party you own, one row per member who has joined. A seat nobody has claimed
// cannot sign in, so it has no row.
export function MemberRoles({
  seats,
  busy,
  onSet,
}: {
  seats: PartyMember[];
  busy: boolean;
  onSet: (memberId: string, role: MemberRole) => void;
}) {
  const joined = seats.filter((seat) => seat.role && !seat.guest);
  if (joined.length === 0) return null;
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
      </div>
    </>
  );
}
