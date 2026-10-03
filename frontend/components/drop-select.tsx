"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { apiAssetUrl } from "@/lib/api";
import {
  PLACEHOLDER,
  dropOptions,
  nextOption,
  panelPlacement,
  type DropOption,
  type Placement,
} from "@/lib/drop-select";
import type { WorldType } from "@/lib/world";
import type { BossDrop } from "@/types/drop";

// Which drop fell, picked by its art.
//
// A coupon is recognised by its icon long before its name is read, and "Whisper of the Source"
// versus "Grindstone of Life" is a slower read than two pictures. An <option> cannot hold an image,
// so this is a listbox: same rows, same labels, same keys as the select it replaces, plus the icon
// the row is already carrying in the drop table.
//
// The choosing logic that a native popup used to provide is in lib/drop-select.ts, under test. This
// file is the markup and the events.

/** The art, or nothing at all. Used by the closed control, which has no column to keep. */
function Icon({ option }: { option: DropOption }) {
  if (!option.iconUrl) return null;
  return <img className="drop-select-icon" src={apiAssetUrl(option.iconUrl)} alt="" />;
}

/** In a row, a missing icon keeps its frame, so the labels line up down the list. */
function RowIcon({ option }: { option: DropOption }) {
  if (!option.iconUrl) return <span className="drop-select-blank" aria-hidden="true" />;
  return <Icon option={option} />;
}

export function DropSelect({
  drops,
  worldType,
  value,
  onChange,
  label,
}: {
  /** Already narrowed to the party's world. See pickableDrops. */
  drops: BossDrop[];
  worldType: WorldType;
  /** A drop key, OTHER, or "" for nothing picked yet. */
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const options = dropOptions(drops, worldType);
  // -1 for nothing picked, and for a value that is not on the list any more (the boss changed under
  // it): both are the placeholder, and neither is a row to mark as selected.
  const chosenIndex = options.findIndex((o) => o.value === value);
  const chosen = options[chosenIndex] ?? PLACEHOLDER;

  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [at, setAt] = useState<Placement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const rowId = (i: number) => `${id}-row-${i}`;

  const place = useCallback(() => {
    const box = triggerRef.current?.getBoundingClientRect();
    if (!box) return;
    setAt(panelPlacement(box, { width: window.innerWidth, height: window.innerHeight }));
  }, []);

  // Before paint, so the panel is never drawn at last time's coordinates first.
  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    // Captured, so an ancestor's scroll is heard too: the picker sits inside a scrolling table on
    // Run Order, and only the window's own scroll event bubbles.
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, place]);

  // Arrowing past the visible rows scrolls them, which is the one thing a `max-height` list needs
  // that a native popup did for itself.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`${id}-row-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [open, active, id]);

  function show() {
    // On the picked row, or the first one when the placeholder is showing.
    setActive(Math.max(0, chosenIndex));
    setOpen(true);
  }

  function choose(option: DropOption) {
    setOpen(false);
    onChange(option.value);
    // Back to the trigger, or the next Tab starts from the top of the document.
    triggerRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        show();
      }
      return;
    }
    if (e.key === "Escape" || e.key === "Tab") {
      // Escape keeps what was picked, Tab lets the browser move on. Neither chooses the highlight.
      setOpen(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActive(nextOption(active, options.length, e.key === "ArrowDown" ? 1 : -1));
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      setActive(e.key === "Home" ? 0 : options.length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      // Enter must not reach the form: this is a choice, not a submit.
      e.preventDefault();
      const option = options[active];
      if (option) choose(option);
    }
  }

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="split-input drop-select"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        aria-activedescendant={open ? rowId(active) : undefined}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={onKeyDown}
      >
        <Icon option={chosen} />
        <span className={`drop-select-label${chosen.value === "" ? " is-empty" : ""}`}>
          {chosen.label}
        </span>
        <span className="drop-select-arrow" aria-hidden="true" />
      </button>

      {/* Portalled and fixed, not absolute: two of the screens carrying this picker clip. See
          panelPlacement. */}
      {open &&
        at &&
        createPortal(
          <ul
            ref={listRef}
            id={id}
            role="listbox"
            aria-label={label}
            className="drop-select-list"
            style={{ position: "fixed", ...at }}
          >
            {options.map((option, i) => (
              <li
                key={option.value}
                id={rowId(i)}
                role="option"
                aria-selected={i === chosenIndex}
                className={`drop-select-row${i === active ? " active" : ""}`}
                // The full name for the ones the row is too narrow for, which the 46px art made
                // more of. A tooltip, not a wider panel: the panel is as wide as the field.
                title={option.label}
                // mousedown, not click: the trigger's blur closes the list before a click lands.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(option);
                }}
                onMouseEnter={() => setActive(i)}
              >
                <RowIcon option={option} />
                <span className="drop-select-label">{option.label}</span>
              </li>
            ))}
          </ul>,
          document.body,
        )}
    </>
  );
}
