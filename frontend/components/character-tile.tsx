"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { type KeyboardEvent, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Character } from "@/types/character";

type Props = {
  character: Character;
  onUpdated: (character: Character) => void;
  onDeleted: (id: string) => void;
  // When the tile is being used to pick whose inventory to show, clicking it selects.
  selected?: boolean;
  onSelect: () => void;
  // Reorder within the carousel. Disabled at the ends.
  onMove: (direction: -1 | 1) => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  // Roving tabindex: only one tile in the strip is a tab stop (the selected one), so Tab reaches
  // the carousel in one press instead of once per character. The carousel owns the arithmetic.
  tabIndex: number;
  onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
};

export function CharacterTile({
  character,
  onUpdated,
  onDeleted,
  selected,
  onSelect,
  onMove,
  canMoveLeft,
  canMoveRight,
  tabIndex,
  onKeyDown,
}: Props) {
  const { getToken } = useAuth();
  const { user } = useUser();
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);

  // The main character is stored on the Clerk user (unsafeMetadata, so it is writable from here
  // without a backend of its own). The sprite is denormalised alongside the id so the header avatar
  // can draw it without re-fetching the roster. See UserAvatar.
  const isMain = user?.unsafeMetadata?.mainCharacterId === character.id;

  async function setMain() {
    if (!user || isMain) return;
    await user.update({
      unsafeMetadata: {
        ...user.unsafeMetadata,
        mainCharacterId: character.id,
        mainCharacterSprite: character.spriteImgUrl ?? null,
      },
    });
  }

  async function refresh() {
    if (refreshing) return;
    setRefreshing(true);
    try {
      const updated = await apiFetch<Character>(
        `/api/characters/${character.id}/refresh`,
        { method: "POST" },
        getToken,
      );
      onUpdated(updated);
    } finally {
      setRefreshing(false);
    }
  }

  async function remove() {
    if (busy) return;
    setBusy(true);
    try {
      await apiFetch<void>(`/api/characters/${character.id}`, { method: "DELETE" }, getToken);
      onDeleted(character.id);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={`char-tile${selected ? " selected" : ""}`}
      onClick={onSelect}
      // The tile is what focus lands on and what the arrow keys move between. The inner controls
      // (star, move, refresh, delete) are their own tab stops and bubble their keys up here, so
      // every key handler below ignores anything that did not happen on the tile itself.
      //
      // aria-current, not a listbox: the strip ends in the "add character" tile, which is not an
      // option and would make the listbox's children a lie. `group` rather than `button` because
      // button makes its descendants presentational, which would hide the four controls inside.
      // A real <button> around the sprite and plate would be better and needs the tile's layout
      // reworked, since it cannot wrap the actions and cannot use display:contents safely.
      role="group"
      aria-label={character.name}
      aria-current={selected ? "true" : undefined}
      tabIndex={tabIndex}
      data-char-id={character.id}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
          return;
        }
        onKeyDown(e);
      }}
    >
      {/* Star to make this character the profile avatar. Always shows on the current main so you can
          see which it is; filled when this tile is it. Clicking must not also select the tile. */}
      <button
        type="button"
        className={`tile-star${isMain ? " is-main" : ""}`}
        aria-label={isMain ? `${character.name} is your main` : `Make ${character.name} your main`}
        aria-pressed={isMain}
        title={isMain ? "Your main" : "Set as main"}
        onClick={(e) => {
          e.stopPropagation();
          setMain();
        }}
      >
        {isMain ? "★" : "☆"}
      </button>

      {character.spriteImgUrl ? (
        <img className="tile-sprite" src={character.spriteImgUrl} alt="" />
      ) : (
        <div className="tile-sprite" />
      )}

      <div className="tile-plate">
        <div className="tile-name">{character.name}</div>
        <div className="tile-meta">
          <span className="tile-level">Lv.{character.level ?? "?"}</span>
          <span className="tile-job">{character.jobName ?? "—"}</span>
        </div>
      </div>

      {/* Clicks here manage the tile, they must not also select it. */}
      <div className="tile-actions" onClick={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="tile-move"
          onClick={() => onMove(-1)}
          disabled={!canMoveLeft}
          aria-label={`Move ${character.name} left`}
        >
          ‹
        </button>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            refresh();
          }}
        >
          {refreshing ? "refreshing…" : "[refresh]"}
        </a>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            remove();
          }}
        >
          [delete]
        </a>
        <button
          type="button"
          className="tile-move"
          onClick={() => onMove(1)}
          disabled={!canMoveRight}
          aria-label={`Move ${character.name} right`}
        >
          ›
        </button>
      </div>
    </div>
  );
}
