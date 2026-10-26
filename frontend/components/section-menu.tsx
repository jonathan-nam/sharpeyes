"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { activeHref, MENU_HREFS, sectionsFor } from "@/lib/section-menu";
import { useAccountSettings } from "@/lib/use-account-settings";
import { useHoverMenu } from "@/lib/use-hover-menu";

// The sections behind a hamburger, for a header too narrow to list them (SectionNav lists them
// otherwise). What it lists, and which entry a path belongs to, are in lib/section-menu.ts, where
// they can be tested: the highlight rule fails silently, by lighting the wrong word rather than by
// erroring.

export function SectionMenu() {
  const pathname = usePathname();
  const active = activeHref(pathname);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const menu = useHoverMenu(ref);
  // Nothing splits in a Heroic world, so the Drop Splitter is off the list while one is shown. It
  // still routes either way, and prefetching it costs nothing worth branching on.
  const sections = sectionsFor(useAccountSettings()?.trades);

  // Panels only mount while open, and <Link> prefetches on entering the viewport, so the routes in
  // them got at most the moment between opening a menu and clicking an item. Warm them from here
  // instead, which is mounted on every page (CSS hides it on a wide header; an effect still runs).
  // Doing it by hiding a rendered panel does not work: display:none never intersects so it would
  // not prefetch at all, and an opacity-hidden panel leaves focusable links inside a closed menu.
  //
  // Every section, deduped by the router cache. No effect under `next dev`, which never prefetches.
  useEffect(() => {
    for (const href of MENU_HREFS) router.prefetch(href);
  }, [router]);

  // The wait for a clicked route is NOT drawn here: it is NavPending, in the layout, so every link
  // in the app gets it.

  return (
    <div className="section-menu" ref={ref} {...menu.hover}>
      <button
        type="button"
        className="section-menu-btn"
        aria-label="Sections"
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={menu.toggle}
      >
        <span className="section-menu-icon" aria-hidden="true" />
      </button>

      {menu.open ? (
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
                    onClick={menu.close}
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
export function InDevelopmentMark() {
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
