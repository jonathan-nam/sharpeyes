import { type RefObject, useEffect } from "react";

/** Closes a header menu on an outside click or Escape, the two ways a menu should always be dismissable. */
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, close: () => void) {
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
    // `close` is a fresh closure every render; what matters is whether the menu is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
}
