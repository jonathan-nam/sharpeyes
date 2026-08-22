"use client";

import { useAuth } from "@clerk/nextjs";
import { useState } from "react";
import { apiFetch, spriteUrl } from "@/lib/api";
import { setAccountSettings, SETTINGS_KEY, useAccountSettings } from "@/lib/use-account-settings";
import type { Character } from "@/types/character";
import type { Settings } from "@/types/settings";

// One character, and everything you can do to it.
//
// A row rather than the carousel's card: this is a list you read down, not a strip you scroll
// along to pick one.

export function CharacterRow({
  character,
  onUpdated,
  onDeleted,
  onMove,
  canMoveUp,
  canMoveDown,
}: {
  character: Character;
  onUpdated: (character: Character) => void;
  onDeleted: (id: string) => void;
  onMove: (direction: -1 | 1) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
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
    const saved = await apiFetch<Settings>(
      `${SETTINGS_KEY}/main-character`,
      { method: "PUT", body: JSON.stringify({ characterId: character.id }) },
      getToken,
    );
    setAccountSettings(saved);
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

  const refresh = () =>
    run(async () => {
      onUpdated(
        await apiFetch<Character>(
          `/api/characters/${character.id}/refresh`,
          { method: "POST" },
          getToken,
        ),
      );
    });

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
    <li className="character-row">
      <button
        type="button"
        className={`tile-star${isMain ? " is-main" : ""}`}
        aria-label={isMain ? `${character.name} is your main` : `Make ${character.name} your main`}
        aria-pressed={isMain}
        title={isMain ? "Your main" : "Set as main"}
        onClick={setMain}
      >
        {isMain ? "★" : "☆"}
      </button>

      {character.spriteImgUrl ? (
        <img className="character-row-sprite" src={spriteUrl(character.spriteImgUrl)} alt="" />
      ) : (
        <span className="character-row-sprite" aria-hidden="true" />
      )}

      <span className="character-row-name">
        <span className="tile-name">{character.name}</span>
        <span className="tile-meta">
          <span className="tile-level">Lv.{character.level ?? "?"}</span>
          <span className="tile-job">{character.jobName ?? "—"}</span>
        </span>
      </span>

      <span className="character-row-actions">
        <button
          type="button"
          className="tile-move"
          onClick={() => onMove(-1)}
          disabled={disabled || !canMoveUp}
          aria-label={`Move ${character.name} up`}
        >
          ↑
        </button>
        <button
          type="button"
          className="tile-move"
          onClick={() => onMove(1)}
          disabled={disabled || !canMoveDown}
          aria-label={`Move ${character.name} down`}
        >
          ↓
        </button>
        <button type="button" className="party-cancel" onClick={refresh} disabled={disabled}>
          {working ? "..." : "Refresh"}
        </button>
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
      </span>
    </li>
  );
}
