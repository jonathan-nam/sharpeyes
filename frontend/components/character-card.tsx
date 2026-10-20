"use client";

import type { ReactNode } from "react";
import { spriteUrl } from "@/lib/api";
import type { Character } from "@/types/character";

// One character as its sprite, with the main's star in the corner. The Characters page and
// onboarding both draw these, so a character looks the same in each. Whatever the page lets you do
// to it goes in `children`, under the plate.
export function CharacterCard({
  character,
  isMain,
  onStar,
  starBusy = false,
  children,
}: {
  character: Character;
  isMain: boolean;
  onStar: () => void;
  starBusy?: boolean;
  children?: ReactNode;
}) {
  return (
    <li className="character-card">
      <button
        type="button"
        className={`tile-star character-card-star${isMain ? " is-main" : ""}`}
        aria-label={isMain ? `${character.name} is your main` : `Make ${character.name} your main`}
        aria-pressed={isMain}
        title={isMain ? "Your Main" : "Set as Main"}
        disabled={starBusy}
        onClick={onStar}
      >
        {isMain ? "★" : "☆"}
      </button>
      {character.spriteImgUrl ? (
        <img className="tile-sprite" src={spriteUrl(character.spriteImgUrl)} alt="" />
      ) : (
        <span className="tile-sprite" aria-hidden="true" />
      )}
      <span className="tile-plate">
        <span className="tile-name">{character.name}</span>
        <span className="tile-meta">
          <span className="tile-level">Lv.{character.level ?? "?"}</span>
          <span className="tile-job">{character.jobName ?? "—"}</span>
        </span>
      </span>
      {children && <span className="character-card-actions">{children}</span>}
    </li>
  );
}
