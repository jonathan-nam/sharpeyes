"use client";

import {
  cloneElement,
  type FocusEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

import { placeTip } from "@/lib/tooltip-position";

/** Long enough that sweeping the pointer across a grid does not strobe tips. */
const OPEN_DELAY = 400;
/** A tip that closed this recently hands over instantly, so reading along a row is not 400ms a cell. */
const HANDOVER = 300;
let lastClosedAt = -Infinity;

function noteClosed() {
  lastClosedAt = performance.now();
}

function handingOver(): boolean {
  return performance.now() - lastClosedAt < HANDOVER;
}

type TriggerProps = {
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  "aria-describedby"?: string;
  "aria-label"?: string;
};

/**
 * The site's hover label, in place of a `title`. Wraps one element without adding a node, so it
 * works on a <th>, an <li> or a button alike.
 *
 * A `title` is a browser box after a second's wait, never on keyboard focus. This opens on hover
 * and on keyboard focus, closes on Escape, a press, or a scroll, and renders into <body> so a
 * table's or a card's overflow cannot clip it. No text, no tip: the child is returned untouched.
 *
 * Touch has no hover. A note somebody on a phone must be able to read is an InfoBubble.
 */
export function Tooltip({
  text,
  children,
}: {
  text: ReactNode | null | undefined;
  children: ReactElement<TriggerProps>;
}) {
  // The element it is open on, or null when closed.
  const [at, setAt] = useState<HTMLElement | null>(null);
  // Hovered, and waiting out OPEN_DELAY.
  const [pending, setPending] = useState<HTMLElement | null>(null);
  const id = useId();

  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => {
      setAt(pending);
      setPending(null);
    }, OPEN_DELAY);
    return () => clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    if (!at) return;
    const close = () => {
      noteClosed();
      setAt(null);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [at]);

  if (text === null || text === undefined || text === "") return children;

  function show(on: HTMLElement, now: boolean) {
    if (now || handingOver()) {
      setPending(null);
      setAt(on);
    } else setPending(on);
  }

  function hide() {
    setPending(null);
    if (at) noteClosed();
    setAt(null);
  }

  const own = children.props;
  const trigger = cloneElement(children, {
    onPointerEnter: (e) => {
      own.onPointerEnter?.(e);
      if (e.pointerType !== "touch") show(e.currentTarget, false);
    },
    onPointerLeave: (e) => {
      own.onPointerLeave?.(e);
      hide();
    },
    onPointerDown: (e) => {
      own.onPointerDown?.(e);
      hide();
    },
    // Keyboard focus only. A click focuses a button too, and a tip popping up under the pointer
    // that just pressed it is noise.
    onFocus: (e) => {
      own.onFocus?.(e);
      if (e.currentTarget.matches(":focus-visible")) show(e.currentTarget, true);
    },
    onBlur: (e) => {
      own.onBlur?.(e);
      hide();
    },
    // Not when the tip only repeats the label, or a screen reader says it twice.
    "aria-describedby":
      at && own["aria-label"] !== text
        ? [own["aria-describedby"], id].filter(Boolean).join(" ")
        : own["aria-describedby"],
  });

  return (
    <>
      {trigger}
      {at && (
        <TipPanel id={id} anchor={at} role="tooltip" className="tooltip">
          {text}
        </TipPanel>
      )}
    </>
  );
}

/**
 * A panel floated against `anchor`, in <body>. Shared by Tooltip and InfoBubble, so a label and a
 * note sit and look the same.
 *
 * Drawn hidden, measured, then placed, all before paint, so it never shows at the wrong spot. It
 * follows the anchor on scroll, for the note that stays open while the page moves.
 */
export function TipPanel({
  id,
  anchor,
  role,
  className,
  prefer = "above",
  children,
}: {
  id: string;
  anchor: HTMLElement;
  role: "tooltip" | "note";
  className: string;
  prefer?: "above" | "below";
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    function place() {
      const box = panel.current;
      if (!box) return;
      const spot = placeTip(
        anchor.getBoundingClientRect(),
        { width: box.offsetWidth, height: box.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        prefer,
      );
      box.style.top = `${spot.top}px`;
      box.style.left = `${spot.left}px`;
      box.style.visibility = "visible";
    }
    place();
    window.addEventListener("scroll", place, { capture: true, passive: true });
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, { capture: true });
      window.removeEventListener("resize", place);
    };
  });

  return createPortal(
    <div id={id} ref={panel} role={role} className={className} style={{ visibility: "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}
