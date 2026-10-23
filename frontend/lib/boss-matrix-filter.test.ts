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

const clear = (bossKey: string) => ({
  bossKey,
  cleared: true,
  periodStart: "2026-10-22",
  capturedAt: "2026-10-22T00:00:00Z",
});

// c1 runs Lotus with a party and Will solo, and has cleared both.
const render = (runFilter: RunFilter | null) =>
  renderToStaticMarkup(
    createElement(BossMatrix, {
      bosses: [boss("lotus"), boss("will")],
      characters: [{ id: "c1", name: "Aria", spriteImgUrl: null }],
      clearsByCharacter: { c1: [clear("lotus"), clear("will")] },
      onToggle: () => {},
      partyRuns: new Map([["c1", new Set(["lotus"])]]),
      runFilter,
    }),
  );

const cellOf = (html: string, bossName: string) => {
  const said = html.indexOf(`${bossName} cleared by Aria`);
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

  it("shows no mark on the cells it leaves out", () => {
    const html = render("party");
    expect(cellOf(html, "lotus")).toContain("✓");
    expect(cellOf(html, "will")).not.toContain("✓");
  });
});

describe("dimming under a run filter", () => {
  // Aria has cleared Lotus with a party and not yet cleared Will, which she runs solo.
  const renderMixed = (runFilter: RunFilter | null) =>
    renderToStaticMarkup(
      createElement(BossMatrix, {
        bosses: [boss("lotus"), boss("will")],
        characters: [{ id: "c1", name: "Aria", spriteImgUrl: null }],
        clearsByCharacter: { c1: [clear("lotus"), { ...clear("will"), cleared: false }] },
        partyRuns: new Map([["c1", new Set(["lotus"])]]),
        runFilter,
      }),
    );
  const rowOf = (html: string, bossName: string) => {
    const name = html.indexOf(`></span>${bossName}</span>`);
    return html.slice(html.lastIndexOf("<tr", name), name);
  };
  const headDone = (html: string) => html.includes("boss-char-head is-col-cleared");

  it("dims the sprite once every counted run is cleared", () => {
    expect(headDone(renderMixed(null))).toBe(false);
    expect(headDone(renderMixed("solo"))).toBe(false);
    expect(headDone(renderMixed("party"))).toBe(true);
  });

  it("dims a boss once every counted run of it is cleared", () => {
    expect(rowOf(renderMixed(null), "lotus")).toContain("is-row-cleared");
    expect(rowOf(renderMixed("solo"), "will")).not.toContain("is-row-");
  });

  it("dims a boss the filter leaves no runs of", () => {
    expect(rowOf(renderMixed(null), "will")).not.toContain("is-row-");
    expect(rowOf(renderMixed("party"), "will")).toContain("is-row-unrun");
    expect(rowOf(renderMixed("solo"), "lotus")).toContain("is-row-unrun");
  });
});

describe("a boss the character does not run", () => {
  it("shows no mark", () => {
    const html = renderToStaticMarkup(
      createElement(BossMatrix, {
        bosses: [boss("will")],
        characters: [{ id: "c1", name: "Aria", spriteImgUrl: null }],
        clearsByCharacter: {},
        skipsByCharacter: { c1: ["will"] },
        onToggle: () => {},
      }),
    );
    const said = html.indexOf("will, Aria doesn&#x27;t run");
    const cell = html.slice(html.lastIndexOf("<td", said), html.indexOf("</td>", said));
    expect(said).toBeGreaterThan(-1);
    expect(cell).toContain('<span aria-hidden="true"></span>');
  });
});
