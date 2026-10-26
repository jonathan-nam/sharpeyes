"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef } from "react";
import { InDevelopmentMark } from "@/components/section-menu";
import { activeHref, SECTIONS, type SectionItem, sectionsFor } from "@/lib/section-menu";
import { useAccountSettings } from "@/lib/use-account-settings";
import { useHoverMenu } from "@/lib/use-hover-menu";

/**
 * The sections, listed in the header: a link per page and a dropdown per group. A narrow header
 * swaps this for SectionMenu's hamburger, in CSS.
 *
 * `reserved` draws the same labels inert, to hold their space until the session resolves (see
 * SiteHeader). The labels are the same for every account, so drawing them is not a guess.
 */
export function SectionNav({ reserved = false }: { reserved?: boolean }) {
  const active = activeHref(usePathname());
  const trades = useAccountSettings()?.trades;
  const sections = reserved ? SECTIONS : sectionsFor(trades);

  return (
    <nav className="section-nav" aria-label={reserved ? undefined : "Sections"}>
      {sections.map((section) => {
        const listed = section.items.filter((item) => !item.hidden);
        if (reserved) {
          return (
            <span key={section.group ?? listed[0]?.href} className="section-nav-link">
              {section.group ?? listed[0]?.label}
              {section.group ? <Chevron /> : null}
            </span>
          );
        }
        if (section.group) {
          return (
            <NavGroup
              key={section.group}
              label={section.group}
              items={listed}
              active={active}
              // A hidden page (Edit People) still lights the group it sits in.
              current={section.items.some((item) => item.href === active)}
            />
          );
        }
        return listed.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={active === item.href ? "section-nav-link active" : "section-nav-link"}
            aria-current={active === item.href ? "page" : undefined}
          >
            {item.label}
          </Link>
        ));
      })}
    </nav>
  );
}

function NavGroup({
  label,
  items,
  active,
  current,
}: {
  label: string;
  items: SectionItem[];
  active: string | undefined;
  current: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const menu = useHoverMenu(ref);

  return (
    <div className="section-nav-group" ref={ref} {...menu.hover}>
      <button
        type="button"
        className={current ? "section-nav-link active" : "section-nav-link"}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        onClick={menu.toggle}
      >
        {label}
        <Chevron />
      </button>
      {menu.open ? (
        <div className="section-menu-panel" role="menu" aria-label={label}>
          {items.map((item) => (
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
      ) : null}
    </div>
  );
}

function Chevron() {
  return (
    <svg
      className="section-nav-chevron"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
