import { usePathname } from "next/navigation";
import { type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";
import { useDismiss } from "@/lib/use-dismiss";

// Hover opens after a short rest, so sweeping across the header does not flash every menu on the
// way. The close grace only forgives an overshoot: the gap down to the panel is bridged in CSS
// (`.section-menu-panel::before`). 250ms read as the menu lagging behind the mouse.
const HOVER_OPEN_MS = 80;
const HOVER_CLOSE_MS = 100;

export type OpenedBy = "hover" | "click" | null;

/**
 * What a menu is after each event.
 *
 * The mouse leaving closes it however it was opened. Clicked menus were once kept open, and since
 * hover opens a menu before a click can land, nearly every mouse click pinned one that then never
 * retracted. A click on a hovered menu keeps it open rather than closing what the user reached for.
 */
export function menuAfter(by: OpenedBy, event: "enter" | "leave" | "click"): OpenedBy {
  if (event === "enter") return by ?? "hover";
  if (event === "leave") return null;
  return by === "click" ? null : "click";
}

/**
 * A header menu that opens on a mouse resting on it, or on a click. Touch is click only: a tap
 * fires pointerenter just before its click, which would open and then toggle.
 */
export function useHoverMenu(ref: RefObject<HTMLElement | null>) {
  const [openedBy, setOpenedBy] = useState<OpenedBy>(null);
  const open = openedBy !== null;
  const close = () => setOpenedBy(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Closed by the route arriving. A menu held open to mark the clicked entry was tried and
  // reverted: one that does not close is read as a click that did not register.
  //
  // During render, not in an effect: an effect closes it a paint later, and the linter refuses it.
  // Not `openedAtPath === pathname` either, which reopens the menu on a Back to the page it was
  // opened from.
  const pathname = usePathname();
  const [pathShown, setPathShown] = useState(pathname);
  if (pathShown !== pathname) {
    setPathShown(pathname);
    close();
  }

  useDismiss(ref, open, close);
  useEffect(() => () => clearTimeout(timer.current), []);

  return {
    open,
    close,
    toggle() {
      clearTimeout(timer.current);
      setOpenedBy((by) => menuAfter(by, "click"));
    },
    hover: {
      onPointerEnter(e: PointerEvent) {
        if (e.pointerType !== "mouse") return;
        clearTimeout(timer.current);
        if (!open)
          timer.current = setTimeout(
            () => setOpenedBy((by) => menuAfter(by, "enter")),
            HOVER_OPEN_MS,
          );
      },
      onPointerLeave(e: PointerEvent) {
        if (e.pointerType !== "mouse") return;
        clearTimeout(timer.current);
        timer.current = setTimeout(
          () => setOpenedBy((by) => menuAfter(by, "leave")),
          HOVER_CLOSE_MS,
        );
      },
    },
  };
}
