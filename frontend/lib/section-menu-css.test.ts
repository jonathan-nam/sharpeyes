import { globSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "app", "globals.css"), "utf8");

// Cascade order that is load-bearing, and whose breakage is invisible rather than loud. A rule
// that loses to a later one at equal specificity does not error, it just quietly stops applying.
// The Bossing group shipped unindented once for exactly this reason.
describe("section menu indentation survives the cascade", () => {
  it("indents nested entries after the rule that sets the flush padding", () => {
    // `.section-menu-panel a` sets `padding` shorthand. At equal specificity the later rule wins,
    // so the indent must come after it or it is reset to flush and the nesting disappears.
    const flush = css.indexOf(".section-menu-panel a {");
    const indent = css.indexOf(".section-menu-group a {");
    expect(flush).toBeGreaterThan(-1);
    expect(indent).toBeGreaterThan(flush);
  });

  it("indents further than the flush entries actually are", () => {
    const flushPadding = /\.section-menu-panel a \{[^}]*padding:\s*\d+px\s+(\d+)px/.exec(css);
    const indented = /\.section-menu-group a \{[^}]*padding-left:\s*(\d+)px/.exec(css);
    expect(Number(indented?.[1])).toBeGreaterThan(Number(flushPadding?.[1]));
  });
});

describe("the header lists the sections or the hamburger, never both", () => {
  it("hides the listed sections after the rule that shows them", () => {
    // Shipped once with the hide first: `.header-nav { display: flex }` won and a narrow header
    // drew the list and the hamburger side by side, overflowing the bar.
    const shown = css.indexOf(".header-nav {");
    const hidden = /@media \(width <= (\d+)px\) \{\s*\.header-nav \{\s*display: none;/.exec(css);
    expect(shown).toBeGreaterThan(-1);
    expect(hidden?.index).toBeGreaterThan(shown);
  });

  it("swaps them at the same width", () => {
    const hide = /@media \(width <= (\d+)px\) \{\s*\.header-nav \{/.exec(css)?.[1];
    const show = /@media \(width > (\d+)px\) \{\s*\.section-menu \{\s*display: none;/.exec(
      css,
    )?.[1];
    expect(hide).toBeDefined();
    expect(hide).toBe(show);
  });
});

describe("the wait for a page that has been asked for", () => {
  // The delay is the design, not a tuning knob: a prefetched route commits in single-figure ms, so
  // without it every navigation would flash the bar and dim the page for a frame. Dropping it
  // turns feedback into a flicker, which is why it is pinned here rather than left to a comment.
  const delayIn = (selector: string) => {
    const rule = new RegExp(
      `${selector.replace(/[.:()]/g, "\\$&")} \\{[^}]*animation:[^;]*?(\\d+)ms`,
    );
    const found = rule.exec(css);
    expect(found, `no delayed animation on ${selector}`).not.toBeNull();
    return Number(found?.[1]);
  };

  it("starts hidden, so nothing is drawn before the delay elapses", () => {
    // `forwards` on a 0s animation is what reveals it at the delay. Without the opacity:0 the bar
    // is simply always on, which is the flicker the delay exists to prevent.
    expect(/\.nav-pending \{[^}]*opacity:\s*0;/.test(css)).toBe(true);
  });

  it("waits the same before the bar and before the dim", () => {
    // Two rules, one moment. Staggering them reads as two separate things happening.
    expect(delayIn(".nav-pending")).toBe(delayIn("body:has(.nav-pending) main"));
    expect(delayIn(".nav-pending")).toBeGreaterThanOrEqual(100);
  });

  it("keeps the delay on the sweep too", () => {
    expect(delayIn(".nav-pending::before")).toBe(delayIn(".nav-pending"));
  });

  // A waiting page is the same wait, and it broke the same way the bar would have without its
  // delay. Measured on the production build: the click committed 12ms in, so /bosses drew its
  // 980px matrix skeleton for one frame between the outgoing 174px page and the incoming 147px
  // one. It lands just AFTER the bar's wait rather than during it, which is why the bar's own
  // delay never covered it.
  it("waits the same before the skeleton as before the bar", () => {
    // `<name> <duration> [easing] <delay>`: duration first, delay second, per comma-separated
    // animation. delayIn() takes the first time it finds, which here is a duration, so every
    // animation on the rule is read on its own and they must agree. The fade and the space it
    // takes have to start at the same moment or the box opens on an empty page.
    const shorthand = /\.page-waiting \{[^}]*animation:\s*([^;]+);/.exec(css)?.[1];
    // Both units, because a 0s duration is spelled 0s and an ms-only match silently reads the
    // delay as the duration and finds nothing to compare.
    const ms = (t: string) =>
      t.endsWith("ms") ? Number(t.slice(0, -2)) : Number(t.slice(0, -1)) * 1000;
    const delays = shorthand?.split(",").map((part) => {
      const times = part.match(/\d+m?s\b/g)?.map(ms);
      expect(times, `expected a duration and a delay in "${part.trim()}"`).toHaveLength(2);
      return times?.[1];
    });
    expect(delays?.length).toBeGreaterThanOrEqual(2);
    for (const delay of delays ?? []) expect(delay).toBe(delayIn(".nav-pending"));
  });

  it("holds the skeleton hidden through the delay", () => {
    // The backwards half of `both` is the whole mechanism. With `forwards` alone the skeleton is
    // simply always on, which is the flicker the delay exists to prevent.
    expect(/\.page-waiting \{[^}]*animation:[^;]*\bboth\b/.test(css)).toBe(true);
    expect(/@keyframes page-waiting-in \{\s*from \{\s*opacity:\s*0;/.test(css)).toBe(true);
  });

  // A placeholder that is the page's own shape gets NO wait treatment: no delay, no fade in, no
  // crossfade out. Each was measured off in turn, on a real click rather than a document load.
  //
  // Held hidden for the delay, the outgoing 747px page went at 9ms and the 801px skeleton did not
  // land until 208ms: 180ms of the title on an empty screen. Faded up from zero instead, a menu
  // click swapped the page for a near-empty screen that rose over 200ms, which is invisible on a
  // REFRESH (no outgoing page to compare against) and obvious on a navigation. Both are gone only
  // if it is drawn at once, at full strength, and bare.
  it("gives a page-shaped placeholder no wait treatment at all", () => {
    expect(css, "drawn at once, so there is nothing for CSS to say").not.toContain(
      ".page-waiting-shaped",
    );
    const boundary = readFileSync(join(__dirname, "..", "components", "route-loading.tsx"), "utf8");
    expect(boundary).toMatch(/PAGE_WAITING_SHAPED = "page"/);

    const swap = readFileSync(join(__dirname, "..", "components", "page-swap.tsx"), "utf8");
    // Bare, and no wrapper: the boundary and the page then render the same thing, so handing over
    // from loading.tsx to the page's own wait changes nothing on screen.
    expect(swap).toMatch(
      /if \(shaped\) return waiting \? <>\{placeholder\}<\/> : <>\{children\}<\/>/,
    );
  });

  // The other end of the same transition, and the half that was got wrong first. Fading the
  // arriving content up on its own is not enough: the placeholder is gone by then, so the page
  // reads as three beats with a blank one in the middle. Traced on the production build, that
  // frame was the full height of the loaded page with only the title on it.
  it("crossfades, so neither half is ever on screen alone", () => {
    expect(/\.page-swap-in \{[^}]*animation:\s*page-swap-in\s+\d+m?s/.test(css)).toBe(true);
    expect(/@keyframes page-swap-in \{\s*from \{\s*opacity:\s*0;/.test(css)).toBe(true);
  });

  // The departing half is script's, and must stay that way. A CSS animation cannot start from where
  // the fade in got to, it restarts from the base opacity: measured in Chromium, a wait ending
  // inside the delay took the placeholder from 0.00 to 1.00 in one frame and then faded all of it
  // out, which is the flicker the delay exists to prevent, arriving one step later.
  it("does not fade the departing placeholder from CSS", () => {
    const rule = /\.page-swap-out \{[^}]*/.exec(css)?.[0] ?? "";
    expect(
      rule,
      "the fade out belongs to page-swap.tsx, which can read the current opacity",
    ).not.toMatch(/animation|transition/);
    expect(css).not.toContain("@keyframes page-swap-out");
  });

  // Both halves over the same span, or one of them is alone on screen for the difference. The
  // arriving half is CSS's and the departing half is the component's, so they agree here.
  it("runs both halves for the same time, and for as long as the component holds them", () => {
    const arriving = /animation:\s*[a-z-]+\s+(\d+)ms/.exec(
      /\.page-swap-in \{[^}]*/.exec(css)?.[0] ?? "",
    )?.[1];
    const held = /CROSSFADE_MS = (\d+)/.exec(
      readFileSync(join(__dirname, "..", "components", "page-swap.tsx"), "utf8"),
    )?.[1];
    expect(arriving).toBe(held);
  });

  // Starting immediately is the point. A delay here is the blank frame back again, with the
  // placeholder already fading and nothing yet risen to replace it.
  it("starts the handover immediately", () => {
    const shorthand = /\.page-swap-in \{[^}]*animation:\s*([^;]+);/.exec(css)?.[1];
    expect(shorthand?.match(/\d+m?s\b/g)).toHaveLength(1);
  });

  // The fade ending must not change the tree's shape. Returning bare children once it was over made
  // React remount the whole page, so a confirm armed or a box typed into in the first 280ms was lost
  // (seen 2026-10-20). The wrappers stay and stop being boxes instead.
  it("keeps the page mounted when the crossfade ends", () => {
    const source = readFileSync(join(__dirname, "..", "components", "page-swap.tsx"), "utf8");
    expect(source).not.toMatch(/if \(!holding\) return/);
    expect(source).toMatch(/className=\{holding \? "page-swap" : "page-swap-done"\}/);
    expect(source).toMatch(/className=\{lingering \? "page-swap-in" : "page-swap-done"\}/);
    expect(/\.page-swap-done \{\s*display:\s*contents;/.test(css)).toBe(true);
  });

  // The placeholder must not hold the content down while it leaves, or the page settles upward
  // when it finally goes: a shift at the end of the very transition meant to remove one.
  it("takes the departing placeholder out of flow", () => {
    expect(/\.page-swap-out \{[^}]*position:\s*absolute;/.test(css)).toBe(true);
  });

  // Every page that stands its own shape in the gap, and BOTH of each page's waits. Marking only
  // one of the pair puts the flicker back at whichever of the two the reader happens to hit: the
  // boundary is what a menu click shows, the page's own wait is what a refresh shows.
  //
  // These three are the pages whose placeholder is a skeleton. The remaining waits stand a line of
  // "Loading..." instead, and a line of text has nothing to fade or dissolve badly, so they keep
  // the delay and the crossfade.
  const SHAPED = [
    ["app/bosses/drops/loading.tsx", "app/bosses/drops/page.tsx"],
    ["app/bosses/loading.tsx", "app/bosses/page.tsx"],
    ["app/inventory/loading.tsx", "app/inventory/page.tsx"],
  ];

  it.each(SHAPED)("%s and %s both draw their skeleton at once", (boundary, page) => {
    const read = (f: string) => readFileSync(join(__dirname, "..", f), "utf8");
    expect(read(boundary)).toContain("<RouteLoading shaped>");
    expect(read(page), "the page's own wait is the one a refresh shows").toMatch(/\bshaped\b/);
  });

  // The list above has to keep up with the skeletons. A new one that quietly keeps the text
  // treatment is the blank screen back on that page, and nothing else would say so.
  it("has every skeleton page in that list", () => {
    const here = join(__dirname, "..");
    const withSkeleton = globSync("app/**/{page,loading}.tsx", { cwd: here }).filter((f) => {
      const src = readFileSync(join(here, f), "utf8");
      // A named *Skeleton component, or the matrix asked to draw itself as one.
      return /<\w+Skeleton\b/.test(src) || /<BossMatrix\s+loading\b/.test(src);
    });
    expect(withSkeleton.sort()).toEqual([...new Set(SHAPED.flat())].sort());
  });

  // A skeleton is REPLACED, not dissolved into what it stood for. Crossfading draws both layouts
  // at once and they do not line up: measured at the midpoint of the fade on a full account, the
  // loaded Add Drop row (which carries a character picker) sat over the skeleton's (which cannot)
  // for the whole 280ms, and so did the Character filter over the Group one. That doubling reads
  // as the page flickering away and filling back in.
  //
  // Nothing is blank in its place. The placeholder goes and the content arrives in one commit; the
  // blank beat PageSwap exists to remove came from fading content UP once the placeholder was gone.
  it("replaces a page-shaped placeholder rather than dissolving it", () => {
    const source = readFileSync(join(__dirname, "..", "components", "page-swap.tsx"), "utf8");
    expect(source).toMatch(/setLingering\(!shaped\)/);
  });

  // Losing either half of this puts the flash back. Dropping the wait class on the way out is what
  // made the read say 1 when the placeholder was at 0, and reading anything other than the live
  // opacity is the same guess by another route.
  it("fades the departing placeholder from the opacity it is actually at", () => {
    const source = readFileSync(join(__dirname, "..", "components", "page-swap.tsx"), "utf8");
    // Only a text placeholder ever departs: a shaped one is replaced outright, above.
    expect(source, "the departing placeholder keeps its delay").toContain(
      '"page-waiting page-swap-out"',
    );
    expect(source).toMatch(/animate\(\s*\[\{\s*opacity:\s*getComputedStyle\(el\)\.opacity\s*\}/);
  });
});

describe("every wait wears the class", () => {
  const root = join(__dirname, "..");
  const read = (f: string) => readFileSync(join(root, f), "utf8");

  // The class is the whole mechanism, so a <main> that spells itself out silently opts back into
  // the flash: the page still works, it just flickers. These are written by copying a neighbour,
  // so this asserts against the tree rather than trusting the copy.
  const boundaries = globSync("app/**/loading.tsx", { cwd: root });

  // A floor, not a count: it exists so a glob that matches nothing passes silently. It moves when
  // a route is added or retired, which is what deleting the Wallet did.
  it("found the boundaries", () => expect(boundaries.length).toBeGreaterThanOrEqual(11));

  it.each(boundaries)("%s renders RouteLoading, not a bare main", (file) => {
    expect(read(file)).toContain("RouteLoading");
    expect(read(file)).not.toContain("<main");
  });

  // A page that fetches its own data does the waiting itself, and that is where the measured
  // flash actually came from: the boundary never renders at all for a route whose payload was
  // already prefetched.
  //
  // Matched on the wait itself, not on the class: a page that forgot the class is exactly what
  // this is for. Characters spells its wait `!loaded` rather than with a LoadState, which is how
  // it sat on a bare `<main className="page">` for as long as this test only looked for the one
  // spelling.
  const pages = globSync("app/**/page.tsx", { cwd: root }).filter((f) =>
    /state === "loading"|!loaded && !failed/.test(read(f)),
  );

  it("found the pages that wait", () => expect(pages.length).toBeGreaterThanOrEqual(10));

  // The reverse of what this asserted first, and the trace of a real click is why. The router
  // unmounts the outgoing page when the route commits (14ms), so a page that hides its own <main>
  // for the 150ms delay shows a blank screen, not the page you came from: four states with nothing
  // in the middle one. The title is known immediately and is not a placeholder for anything.
  it.each(pages)("%s does not hide its own main, title and all", (file) => {
    expect(read(file), "the delay belongs on the placeholder, not the page").not.toContain(
      "PAGE_WAITING",
    );
  });

  // It still has to be somewhere, or a load that finishes inside 150ms flashes a placeholder it
  // never needed. PageSwap puts it on the placeholder; Run Order has no PageSwap and spells it out.
  it.each(pages)("%s still delays its placeholder", (file) => {
    expect(read(file)).toMatch(/PageSwap|page-waiting/);
  });

  // Run Order alone. Its page is not one block that arrives: the roster, the clock and the plan
  // are drawn off derived state and come and go as the source is toggled, so a fade on them would
  // fire on a click rather than on the load. What its own load state gates is an empty-list line
  // and a checkbox.
  const ARRIVES_IN_PIECES = ["app/bosses/order/page.tsx"];

  it.each(pages.filter((f) => !ARRIVES_IN_PIECES.includes(f)))(
    "%s hands over through PageSwap, so neither half is on screen alone",
    (file) => {
      expect(read(file)).toContain("PageSwap");
    },
  );

  // The bug this whole thing exists to stop, in the form it would come back in: a page that keeps
  // its own `state === "loading"` branch alongside PageSwap renders the placeholder twice, once
  // inside the crossfade and once beside it, and only one of them fades.
  it.each(pages.filter((f) => !ARRIVES_IN_PIECES.includes(f)))(
    "%s draws its placeholder only inside the handover",
    (file) => {
      expect(read(file)).not.toMatch(/\{(state === "loading"|!loaded && !failed) && </);
    },
  );
});
