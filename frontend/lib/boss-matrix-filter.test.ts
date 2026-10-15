import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BossMatrix } from "@/components/boss-matrix";
import type { RunFilter } from "@/lib/boss-clears";

const boss = (bossKey: string) => ({
  bossKey,
  name: bossKey,
  reset: "WEEKLY",
  iconUrl: null,
  difficulties: [],
});

// c1 runs Lotus with a party and Will solo.
const render = (runFilter: RunFilter | null) =>
  renderToStaticMarkup(
    createElement(BossMatrix, {
      bosses: [boss("lotus"), boss("will")],
      characters: [{ id: "c1", name: "Aria", spriteImgUrl: null }],
      clearsByCharacter: {},
      onToggle: () => {},
      partyRuns: new Map([["c1", new Set(["lotus"])]]),
      runFilter,
    }),
  );

const cellOf = (html: string, bossName: string) => {
  const said = html.indexOf(`${bossName}, Aria`);
  const open = html.lastIndexOf("<td", said);
  return html.slice(open, html.indexOf("</td>", said));
};

describe("a run filter on the live matrix", () => {
  it("leaves every cell a control with no chip on", () => {
    const html = render(null);
    expect(cellOf(html, "lotus")).toContain("<button");
    expect(cellOf(html, "will")).toContain("<button");
    expect(html).not.toContain("is-filtered-out");
  });

  it("takes the control off the cells it leaves out, and only those", () => {
    const html = render("party");
    expect(cellOf(html, "lotus")).not.toContain("is-filtered-out");
    expect(cellOf(html, "lotus")).toContain("<button");
    expect(cellOf(html, "will")).toContain("is-filtered-out");
    expect(cellOf(html, "will")).not.toContain("<button");
  });
});
