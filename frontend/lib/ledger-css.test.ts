import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// The × that removes a tranche is a `button.link`, whose own rule is an underlined accent colour.
// A plain `.ledger-drop-sale` loses to it on specificity, and the discard silently becomes what
// looks like a link out of the page. Nothing the component can assert about itself.
describe("the control that drops a sale", () => {
  it("beats button.link, which is element-qualified", () => {
    expect(css).toMatch(/button\.ledger-drop-sale \{/);
  });
});

// The picker replaced three labelled boxes, so it carries their words ("they took mine, at a price")
// and needs the same room the looter select gets. Unstyled it renders at the browser default and the
// longest option is what clips.
describe("the disposition picker", () => {
  it("is sized like the other select this app styles", () => {
    expect(css).toMatch(/\.ledger-sale select\.split-input \{/);
  });
});

// The instruction is a count above the control it is about.
describe("the progress line", () => {
  // This asked for tabular figures and used to get them. Maplestory has none and no `tnum` to turn
  // on, so the declaration is inert and the count DOES shift as it changes. It stays because it is
  // still the right ask and costs nothing the day the face changes. The test asserts the ask, not
  // an alignment the app can no longer promise, which is the whole difference.
  it("still asks for tabular figures, though the face does not answer", () => {
    const rule = css.match(/^\.ledger-progress \{([^}]*)\}/m);
    expect(rule?.[1]).toContain("font-variant-numeric: tabular-nums");
  });
});

// The two steps are what the card is FOR: what became of the coupons, then what came back for them.
// Unstyled, the labels render at body size and read as headings, which boxes off a card that is one
// thing in two stages.
describe("the step labels", () => {
  it("are quieter than the rows they introduce", () => {
    const rule = css.match(/^\.ledger-step \{([^}]*)\}/m);
    // Muted and a step below body. This used to be carried by uppercase too, which went with the
    // rest of the app's tiny caps; colour and size are what hold the label under its rows now.
    expect(rule?.[1]).toContain("font-size: var(--text-sm)");
    expect(rule?.[1]).toContain("var(--muted)");
  });
});

// A settled pile stays on the list and says so, because these bosses drop vestiges on every clear: the
// card is a fixture, and hiding it would only mean it reappeared next week.
describe("the fully-settled state", () => {
  it("is styled as a quiet statement rather than a figure to act on", () => {
    const rule = css.match(/^\.ledger-done \{([^}]*)\}/m);
    expect(rule?.[1]).toContain("var(--muted)");
  });

  it("has no toggle left to hide it behind", () => {
    expect(css).not.toContain("ledger-closed-toggle");
  });
});

// The way forward is top right. Two rules that only work together: `margin-left: auto` needs a
// flex row with free space to push into.
describe("the next stage's link", () => {
  it("sits in a flex row", () => {
    const rule = css.match(/^\.droplog-head-row \{([^}]*)\}/m);
    expect(rule?.[1]).toContain("display: flex");
  });

  it("is pushed to the far end", () => {
    const rule = css.match(/^\.droplog-head-next \{([^}]*)\}/m);
    expect(rule?.[1]).toContain("margin-left: auto");
  });
});

// A drop row names who it was run with, so its meta line grew by up to three names. The row is a
// nowrap flex, and a column that sizes to its content does not give any of it back: the status chip
// went off the right rather than the text getting narrower. Three rules, none of which works alone.
describe("the drop row's meta line", () => {
  it("takes the spare width, so there is something to shrink", () => {
    const rule = css.match(/^\.droplog-title \{([^}]*)\}/m);
    expect(rule?.[1]).toContain("flex: 1");
  });

  it("may go narrower than its own text, which a flex item otherwise refuses to", () => {
    const rule = css.match(/^\.droplog-title \{([^}]*)\}/m);
    expect(rule?.[1]).toContain("min-width: 0");
  });

  it("clips to one line rather than pushing the row wider", () => {
    // `display: block` is part of the clip, not a tidy-up: `.loot-meta` is inline-flex, and
    // text-overflow has nothing to act on in a box with no text of its own.
    const rule = css.match(/^\.droplog-title \.loot-meta \{([^}]*)\}/m);
    expect(rule?.[1]).toContain("display: block");
    expect(rule?.[1]).toContain("white-space: nowrap");
    expect(rule?.[1]).toContain("overflow: hidden");
    expect(rule?.[1]).toContain("text-overflow: ellipsis");
  });
});
