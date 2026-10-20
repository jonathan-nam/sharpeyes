"use client";

import Link from "next/link";

/** A party somebody you are linked to already keeps with you: open theirs, or add this one anyway. */
export function DuplicateParty({
  refusal,
  partyId,
  busy,
  onAddAnyway,
}: {
  refusal: string;
  partyId: string;
  busy: boolean;
  onAddAnyway: () => void;
}) {
  return (
    <p className="split-error duplicate-party">
      {refusal}{" "}
      <Link className="party-cancel" href={`/bosses/parties/${partyId}`}>
        Open Theirs
      </Link>{" "}
      <button type="button" className="party-save" onClick={onAddAnyway} disabled={busy}>
        Add Anyway
      </button>
    </p>
  );
}
