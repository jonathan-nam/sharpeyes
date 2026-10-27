"use client";

import { usePathname } from "next/navigation";
import { ButtonLink } from "@/components/button";
import {
  dropSections,
  sectionFromPath,
  sectionHref,
  sectionSteps,
  shownSection,
} from "@/lib/drop-sections";
import { useAccountSettings } from "@/lib/use-account-settings";

/**
 * A stage's title, with the stage before and the one after on the same line at the right. Read off
 * the path and the world rather than passed in, so the route boundary draws the same one as the page.
 */
export function DropLogHead() {
  const sections = dropSections(useAccountSettings()?.trades);
  const section = shownSection(sectionFromPath(usePathname()) ?? "drops", sections);
  const { back, next } = sectionSteps(section, sections);
  const label = sections.find((s) => s.key === section)?.label;

  return (
    <div className="page-head">
      <h1 className="page-title">{label}</h1>
      {(back || next) && (
        <span className="page-head-links">
          {back && (
            <ButtonLink variant="secondary" className="droplog-step" href={sectionHref(back.key)}>
              <Arrow back />
              {back.label}
            </ButtonLink>
          )}
          {next && (
            <ButtonLink variant="secondary" className="droplog-step" href={sectionHref(next.key)}>
              {next.key === "settled" ? (
                <>View {next.label}</>
              ) : (
                <>
                  {next.label}
                  <Arrow />
                </>
              )}
            </ButtonLink>
          )}
        </span>
      )}
    </div>
  );
}

// Drawn, not typed: Maplestory's arrow glyph is a hairline beside its letters. After Lucide's
// arrow-left and arrow-right (ISC).
function Arrow({ back = false }: { back?: boolean }) {
  return (
    <svg
      className="droplog-step-arrow"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {back ? <path d="m12 19-7-7 7-7M19 12H5" /> : <path d="M5 12h14m-7-7 7 7-7 7" />}
    </svg>
  );
}
