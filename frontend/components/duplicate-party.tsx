"use client";

import { Button, ButtonLink } from "@/components/button";

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
      <ButtonLink variant="secondary" href={`/bosses/parties/${partyId}`}>
        Open Theirs
      </ButtonLink>{" "}
      <Button variant="primary" onClick={onAddAnyway} disabled={busy}>
        Add Anyway
      </Button>
    </p>
  );
}
