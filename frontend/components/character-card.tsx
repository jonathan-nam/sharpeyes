"use client";

import type { DragEvent, ReactNode } from "react";
import { Tooltip } from "@/components/tooltip";
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
  reorder,
  children,
}: {
  character: Character;
  isMain: boolean;
  onStar: () => void;
  starBusy?: boolean;
  /** Drag onto another card, or pick up by the grip and click where it goes. See CardReorder. */
  reorder?: CardReorder;
  children?: ReactNode;
}) {
  return (
    <li
      className={`character-card${reorder?.picked ? " is-picked" : ""}${reorder?.target ? " is-target" : ""}`}
      draggable={reorder !== undefined}
      onDragStart={reorder?.onDragStart}
      onDragOver={reorder?.onDragOver}
      onDragLeave={reorder?.onDragLeave}
      onDrop={reorder?.onDrop}
      onClick={reorder?.onPlace}
    >
      {reorder && (
        // The People page's grip, and its pickup: a click on it lifts the card, a click on another
        // card puts it there. Dragging needs a mouse; this works on a touch screen too.
        <button
          type="button"
          className="person-grip character-card-grip"
          aria-label={reorder.picked ? `Put ${character.name} down` : `Move ${character.name}`}
          aria-pressed={reorder.picked}
          onClick={(e) => {
            e.stopPropagation();
            reorder.onPick();
          }}
        />
      )}
      <Tooltip text={isMain ? "Your Main" : "Set as Main"}>
        <button
          type="button"
          className={`tile-star character-card-star${isMain ? " is-main" : ""}`}
          aria-label={
            isMain ? `${character.name} is your main` : `Make ${character.name} your main`
          }
          aria-pressed={isMain}
          disabled={starBusy}
          onClick={onStar}
        >
          {isMain ? "★" : "☆"}
        </button>
      </Tooltip>
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

/** What a card needs to be moved within its list. The list owns where it goes. */
export type CardReorder = {
  picked: boolean;
  target: boolean;
  onPick: () => void;
  /** A click on the card while another is picked up: put that one here. */
  onPlace: () => void;
  onDragStart: (e: DragEvent) => void;
  onDragOver: (e: DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: DragEvent) => void;
};
