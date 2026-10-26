"use client";

import { type ReactNode, useEffect, useState } from "react";

export type NavSection = {
  id: string;
  label: string;
  /** Waiting on you. Not drawn at zero. */
  count?: number;
};

// How far below the viewport's top a section's heading counts as reached. Matches the sections'
// scroll-margin-top in globals.css, so a click on a link lights that link.
const REACHED_PX = 24;

/**
 * A page's sections, as a sticky column of links beside them, or a row above them on a narrow page.
 * The link lit is the last section whose heading has scrolled past the top, or the last section
 * once the page cannot scroll further, since a short one at the bottom may never reach the top.
 */
export function SectionNav({
  sections,
  children,
}: {
  sections: NavSection[];
  children: ReactNode;
}) {
  const [active, setActive] = useState<string | undefined>(sections[0]?.id);
  const ids = sections.map((s) => s.id).join(" ");

  useEffect(() => {
    const list = ids.split(" ").filter(Boolean);
    function update() {
      const atBottom =
        window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      let current = list[0];
      for (const id of list) {
        const top = document.getElementById(id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= REACHED_PX + 1) current = id;
      }
      setActive(atBottom && window.scrollY > 0 ? list[list.length - 1] : current);
    }
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [ids]);

  return (
    <div className="social-layout">
      <nav className="social-toc" aria-label="Sections">
        {sections.map((s) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className={s.id === active ? "active" : undefined}
            aria-current={s.id === active ? "location" : undefined}
          >
            {s.label}
            {s.count ? <span className="social-toc-count">{s.count}</span> : null}
          </a>
        ))}
      </nav>
      <div className="social-body">{children}</div>
    </div>
  );
}
