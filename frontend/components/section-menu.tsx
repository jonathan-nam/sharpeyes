"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useDismiss } from "@/lib/use-dismiss";
import { activeHref, MENU_HREFS, sectionsFor } from "@/lib/section-menu";
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
  // Nothing splits in a Heroic world, so the Split Utility is off the list while one is shown. It
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
    for (const href of MENU_HREFS) router.prefetch(href);
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
              {section.items
                .filter((item) => !item.hidden)
                .map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    role="menuitem"
                    className={active === item.href ? "active" : ""}
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
            </div>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
