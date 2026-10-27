import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dropSections } from "./drop-sections";

const root = join(__dirname, "..");
const skeleton = readFileSync(join(root, "components", "drop-log-skeleton.tsx"), "utf8");
const page = readFileSync(join(root, "app", "bosses", "drops", "(log)", "layout.tsx"), "utf8");

// The Drop Log's loading state has to be the page's SHAPE, not a line of text where a page will be.
// Screenshotting a real click is what settled it: the old placeholder left 1.3s of an all-but-empty
// screen and then everything at once, which no amount of crossfading fixes, because the two things
// being faded were 132px and 1204px.
//
// Measured on the production build once the skeleton was in: every element above the list (tabs,
// Add Drop panel, its form, the Group filter, the group heading, the first row) sits at the SAME
// offset loading and loaded. Nothing here can re-measure that, so what is pinned is the thing that
// would break it: a piece of chrome the page draws and the skeleton forgets.
//
// The stat row was in that list until the count of drops went to the Settled View. It is pinned by
// its absence now, below, because a placeholder for a row the page does not draw jumps exactly as
// far as a missing one, in the other direction.
describe("the Drop Log's loading state is the page's shape", () => {
  // Split by who renders it. The page draws the heading and the list itself; the Add Drop panel is
  // LogDrop's and its row of controls is DropPicker's. Asserting all of them against page.tsx
  // passed nothing and only proved the test had not been run.
  const OWN = ["DropLogHead", "party-toolbar", "droplog-list"];
  const BORROWED = [
    ["add-section", join("components", "log-drop.tsx")],
    ["add-card", join("components", "drop-picker.tsx")],
    ["add-fields", join("components", "drop-picker.tsx")],
    // The labels are half the panel's height now, so a skeleton without them jumps by a line.
    ["add-field", join("components", "drop-picker.tsx")],
  ] as const;

  it.each(OWN)("draws the page's own %s", (cls) => {
    expect(page, `${cls} is no longer the page's own chrome`).toContain(cls);
    expect(
      skeleton,
      `the skeleton is missing ${cls}, so the page will jump when data lands`,
    ).toContain(cls);
  });

  it.each(BORROWED)("draws %s, which %s owns", (cls, owner) => {
    expect(readFileSync(join(root, owner), "utf8"), `${cls} has moved`).toContain(cls);
    expect(skeleton, `the skeleton is missing ${cls}`).toContain(cls);
  });

  // The heading is the one part with real words on it, and they are a constant, so it can read them
  // rather than restate them. Hardcoding the labels is how it ends up a rename behind.
  it("takes its heading from dropSections rather than spelling it out", () => {
    expect(skeleton).toContain("dropSections");
    for (const section of dropSections(true)) {
      expect(skeleton, `${section.label} is hardcoded`).not.toContain(`>${section.label}<`);
    }
  });

  // A Heroic world gets one section, so the page draws no heading for it. A skeleton that held one
  // would jump by its whole height the moment the drops landed.
  it("draws the heading on the same condition the page does", () => {
    for (const [file, source] of [
      ["the page", page],
      ["the skeleton", skeleton],
    ] as const) {
      expect(source, `${file} draws the heading unconditionally`).toContain("sections.length > 1");
    }
    expect(skeleton, "the skeleton cannot know the world").toContain("useAccountSettings");
  });

  // Every figure on this page is somebody's money. A placeholder that says "Total Sales" to an account
  // that never sells, or draws a number-shaped thing that reads as a number, is the confident wrong
  // statement this repo exists to prevent.
  it("puts no words on screen it cannot know the contents of", () => {
    // Comments stripped first: this file explains why those words are absent, and matching its own
    // explanation is how a regex-over-source test passes for the wrong reason.
    const drawn = skeleton.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const word of ["Total Sales", "My Share", ">Drops<"]) {
      expect(drawn, `the skeleton states "${word}" before it can know it`).not.toContain(word);
    }
  });

  // The other direction, and the one this page has actually been wrong in: the skeleton drew three
  // tiles for a row that had gone down to one, and then to none. A placeholder for chrome the page
  // does not draw is the same height jump as a forgotten one.
  it("draws no stat row, because the tab no longer has one", () => {
    const drawn = skeleton.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const cls of ["stat-row", "stat-tile"]) {
      expect(page, `the drops tab draws ${cls} again, so the skeleton has to`).not.toContain(cls);
      expect(drawn, `the skeleton draws ${cls} where the page draws none`).not.toContain(cls);
    }
  });

  // Both entry points, or a route reached cold flashes a different shape than one reached by a
  // click. See app/inventory/loading.tsx for why the boundary exists at all.
  it("is what the route boundary shows too", () => {
    const boundary = readFileSync(join(root, "app", "bosses", "drops", "loading.tsx"), "utf8");
    expect(boundary).toContain("DropLogSkeleton");
    expect(page).toContain("DropLogSkeleton");
  });
});
