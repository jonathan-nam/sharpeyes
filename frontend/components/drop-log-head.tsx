"use client";

import { usePathname } from "next/navigation";
import { ButtonLink } from "@/components/button";
import {
  dropSections,
  homeSections,
  sectionFromPath,
  sectionHref,
  sectionSteps,
  shownSection,
} from "@/lib/drop-sections";
import { useAccountSettings } from "@/lib/use-account-settings";

/**
 * A stage's title, and a row under it with the stage before and then the one after. Read off the
 * path and the world rather than passed in, so the route boundary draws the same one as the page.
 */
export function DropLogHead() {
  const sections = dropSections(useAccountSettings()?.trades);
  const section = shownSection(sectionFromPath(usePathname()) ?? "drops", sections);
  const { back, next } = sectionSteps(section, sections);
  const label = sections.find((s) => s.key === section)?.label;
  // Every way back the menu's stages have, drawn unseen under the real one, so the slot is as wide
  // on every page and the way forward starts at the same place, Drops included.
  const backs = homeSections(useAccountSettings()?.trades).slice(0, -1);

  return (
    <>
      <h1 className="page-title">{label}</h1>
      {(back || next) && (
        <div className="droplog-steps">
          <span className="droplog-step-back">
            {backs.map((s) => (
              <span key={s.key} className="party-cancel droplog-step is-ghost" aria-hidden="true">
                <Arrow back />
                {s.label}
              </span>
            ))}
            {back && (
              <ButtonLink variant="secondary" className="droplog-step" href={sectionHref(back.key)}>
                <Arrow back />
                {back.label}
              </ButtonLink>
            )}
          </span>
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
        </div>
      )}
    </>
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
