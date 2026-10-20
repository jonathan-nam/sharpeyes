"use client";

import { useAuth } from "@/lib/use-auth";
import { useState } from "react";
import { CharacterCard, type CardReorder } from "@/components/character-card";
import { apiFetch } from "@/lib/api";
import { saveMainCharacter, useAccountSettings } from "@/lib/use-account-settings";
import type { Character } from "@/types/character";

// One character on /characters, and everything you can do to it, as a CharacterCard.

export function CharacterRow({
  character,
  onDeleted,
  reorder,
}: {
  character: Character;
  onDeleted: (id: string) => void;
  reorder: CardReorder;
}) {
  const { getToken } = useAuth();
  const settings = useAccountSettings();
  const [working, setWorking] = useState(false);
  // Deleting takes this character's token counts, boss clears and party seats with it, and there
  // is no undo. It was a hover-only [delete] link on the carousel tile; on a page that lists every
  // character with the button always showing, one stray click is a whole character.
  const [confirming, setConfirming] = useState(false);

  const isMain = settings?.mainCharacterId === character.id;

  async function setMain() {
    if (isMain) return;
    // The response is the whole settings object, so the header avatar redraws off the same read
    // that confirmed the write rather than off what this row assumed it did.
    await saveMainCharacter(character.id, getToken);
  }

  async function run(work: () => Promise<void>) {
    if (working) return;
    setWorking(true);
    try {
      await work();
    } finally {
      setWorking(false);
    }
  }

  const remove = () =>
    run(async () => {
      await apiFetch<void>(`/api/characters/${character.id}`, { method: "DELETE" }, getToken);
      onDeleted(character.id);
    });

  // This row only, and only while its own refresh or delete is in flight: a Nexon lookup takes
  // seconds and its answer overwrites this character. A page-wide flag here was what made every
  // other row's buttons flash on a world click. See persist() on the page.
  const disabled = working;

  return (
    <CharacterCard character={character} isMain={isMain} onStar={setMain} reorder={reorder}>
      {confirming ? (
        <>
          <button type="button" className="party-delete" onClick={remove} disabled={disabled}>
            Delete {character.name}?
          </button>
          <button
            type="button"
            className="party-cancel"
            onClick={() => setConfirming(false)}
            disabled={disabled}
          >
            Keep
          </button>
        </>
      ) : (
        <button
          type="button"
          className="party-delete"
          onClick={() => setConfirming(true)}
          disabled={disabled}
        >
          Delete
        </button>
      )}
    </CharacterCard>
  );
}
