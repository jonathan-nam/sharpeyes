"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useDismiss } from "@/lib/use-dismiss";
import { activeHref, HREFS, sectionsFor } from "@/lib/section-menu";
import { useAccountSettings } from "@/lib/use-account-settings";

// Account sections live behind a hamburger beside the brand. What it lists, and which entry a path
// belongs to, are in lib/section-menu.ts, where they can be tested: the highlight rule fails
// silently, by lighting the wrong word rather than by erroring.

export function SectionMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const active = activeHref(pathname);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  // Nothing splits in a Heroic world, so the Drop Splitter is off the list while one is shown. It
  // still routes either way, and prefetching it costs nothing worth branching on.
  const sections = sectionsFor(useAccountSettings()?.trades);

  // The panel below only mounts while the menu is open, and <Link> prefetches on entering the
  // viewport, so the routes got at most the moment between opening the menu and clicking an item.
  // Warm them from the header instead, which is mounted on every page. Doing it by hiding a
  // rendered panel does not work: display:none never intersects so it would not prefetch at all,
  // and an opacity-hidden panel leaves focusable links inside a closed menu.
  //
  // Every section, deduped by the router cache. No effect under `next dev`, which never prefetches.
  useEffect(() => {
    for (const href of HREFS) router.prefetch(href);
  }, [router]);

  // Closed by the route arriving. The wait itself is NOT drawn here: it is NavPending, in the
  // layout, so every link in the app gets it and not just these seven. Holding the panel open to
  // mark the clicked entry was tried and reverted, because a menu that does not close is read as a
  // click that did not register.
  //
  // During render, not in an effect: an effect closes it a paint later, and the linter refuses it.
  // Not `openedAtPath === pathname` either, which reopens the menu on a Back to the page it was
  // opened from.
  const [pathShown, setPathShown] = useState(pathname);
  if (pathShown !== pathname) {
    setPathShown(pathname);
    setOpen(false);
  }

  useDismiss(ref, open, () => setOpen(false));

  return (
    <div className="section-menu" ref={ref}>
      <button
        type="button"
        className="section-menu-btn"
        aria-label="Sections"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="section-menu-icon" aria-hidden="true" />
      </button>

      {open ? (
        <nav className="section-menu-panel" role="menu">
          {sections.map((section) => (
            <div
              key={section.group ?? section.items[0]?.href}
              className={section.group ? "section-menu-group" : undefined}
              role={section.group ? "group" : undefined}
              aria-label={section.group}
            >
              {section.group ? <p className="section-menu-group-label">{section.group}</p> : null}
              {section.items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  className={active === item.href ? "active" : ""}
                  onClick={() => setOpen(false)}
                >
                  {item.label}
                  {item.inDevelopment ? <InDevelopmentMark /> : null}
                </Link>
              ))}
            </div>
          ))}
        </nav>
      ) : null}
    </div>
  );
}

// A conical flask, after Lucide's flask-conical (ISC).
function InDevelopmentMark() {
  return (
    <svg
      className="section-menu-dev"
      role="img"
      aria-label="In Development"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>In Development</title>
      <path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" />
      <path d="M8.5 2h7" />
      <path d="M7 16h10" />
    </svg>
  );
}
