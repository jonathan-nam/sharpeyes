"use client";

import { useState } from "react";
import type { CardReorder } from "@/components/character-card";

// A drag carrying a card id, so a drop from anywhere else is not read as one.
const DRAG_TYPE = "application/x-sharpeyes-card";

/**
 * Reordering a list of cards by drag, or by picking one up at its grip and clicking where it goes.
 *
 * Returns the props for one card. `group` is the ids it may move among: a card dropped outside its
 * own group goes nowhere, which is how /characters keeps a character inside its world.
 */
export function useCardReorder(onMove: (id: string, targetId: string) => void) {
  const [picked, setPicked] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  return (id: string, group: string[]): CardReorder => {
    const place = (moving: string | null) => {
      setPicked(null);
      setOver(null);
      if (moving !== null && moving !== id && group.includes(moving)) onMove(moving, id);
    };
    return {
      picked: picked === id,
      target: over === id,
      onPick: () => setPicked(picked === id ? null : id),
      onPlace: () => {
        if (picked !== null) place(picked);
      },
      onDragStart: (e) => {
        e.dataTransfer.setData(DRAG_TYPE, id);
        e.dataTransfer.effectAllowed = "move";
      },
      onDragOver: (e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setOver(id);
      },
      onDragLeave: () => setOver(null),
      onDrop: (e) => {
        e.preventDefault();
        place(e.dataTransfer.getData(DRAG_TYPE) || null);
      },
    };
  };
}

/** [list] with the item [id] moved to where [targetId] is. The same list when either is missing. */
export function movedTo<T extends { id: string }>(list: T[], id: string, targetId: string): T[] {
  const from = list.findIndex((item) => item.id === id);
  const to = list.findIndex((item) => item.id === targetId);
  if (from < 0 || to < 0 || from === to) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved!);
  return next;
}
