import { usePathname } from "next/navigation";
import { type PointerEvent, type RefObject, useEffect, useRef, useState } from "react";
import { useDismiss } from "@/lib/use-dismiss";

// Hover opens after a short rest, so sweeping across the header does not flash every menu on the
// way, and closes after a grace that covers the gap between the button and its panel.
const HOVER_OPEN_MS = 80;
const HOVER_CLOSE_MS = 250;

/**
 * A header menu that opens on a mouse resting on it, or on a click.
 *
 * A hovered menu closes when the mouse leaves; a clicked one stays until dismissed. Clicking a menu
 * hover already opened pins it rather than closing what the user reached for. Touch is click only:
 * a tap fires pointerenter just before its click, which would open and then toggle.
 */
export function useHoverMenu(ref: RefObject<HTMLElement | null>) {
  const [openedBy, setOpenedBy] = useState<"hover" | "click" | null>(null);
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
      setOpenedBy((by) => (by === "click" ? null : "click"));
    },
    hover: {
      onPointerEnter(e: PointerEvent) {
        if (e.pointerType !== "mouse") return;
        clearTimeout(timer.current);
        if (!open) timer.current = setTimeout(() => setOpenedBy("hover"), HOVER_OPEN_MS);
      },
      onPointerLeave(e: PointerEvent) {
        if (e.pointerType !== "mouse") return;
        clearTimeout(timer.current);
        timer.current = setTimeout(
          () => setOpenedBy((by) => (by === "hover" ? null : by)),
          HOVER_CLOSE_MS,
        );
      },
    },
  };
}
