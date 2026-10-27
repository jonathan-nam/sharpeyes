import { ButtonLink } from "@/components/button";
import { SectionMark } from "@/components/section-mark";
import {
  type DropSection,
  type DropSectionKey,
  sectionHref,
  sectionSteps,
} from "@/lib/drop-sections";

/**
 * A stage's heading, with the stages either side of it. The way forward is top right; with a way
 * back as well, both go on a line of their own under the heading.
 */
export function DropLogHead({
  section,
  sections,
}: {
  section: DropSectionKey;
  sections: DropSection[];
}) {
  const { back, next } = sectionSteps(section, sections);
  const label = sections.find((s) => s.key === section)?.label;
  const forward = next && (
    <ButtonLink variant="secondary" className="droplog-head-next" href={sectionHref(next.key)}>
      {next.key === "settled" ? <>View {next.label}</> : <>{next.label} &rarr;</>}
    </ButtonLink>
  );

  return (
    <div className="droplog-head">
      <div className="droplog-head-row">
        <h2 className="droplog-head-title">
          <SectionMark section={section} />
          {label}
        </h2>
        {!back && forward}
      </div>
      {back && (
        <div className="droplog-head-row">
          <ButtonLink variant="secondary" href={sectionHref(back.key)}>
            &larr; {back.label}
          </ButtonLink>
          {forward}
        </div>
      )}
    </div>
  );
}
