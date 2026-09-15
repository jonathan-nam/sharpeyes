// What the hamburger lists, and which entry a path belongs to.
//
// Split out of the component because the highlight rule has a silent failure mode: a path that
// resolves to the wrong entry does not error, it just lights the wrong word. See the tests.

export type SectionItem = {
  href: string;
  label: string;
  /**
   * Only listed while the world being shown can trade.
   *
   * The page still exists and still routes, so an old link is not a dead end, and toggling back is
   * one click. It is off the menu because there is nothing to split in a Heroic world, and offering
   * the tool anyway is the app explaining a control that cannot be used from here.
   */
  interactiveOnly?: boolean;
  /**
   * In the menu's routing but not on its list.
   *
   * A page reached from inside another section rather than from the hamburger. It still has to be
   * MATCHED, or the longest-match rule below falls back to a shorter href and lights up a section
   * the page is not in: /bosses/people would otherwise resolve to /bosses and read as
   * "Individual View".
   */
  hidden?: boolean;
};

/**
 * A group is a heading with its own links, NOT a link itself: there is no /bossing page, and a
 * heading that navigated nowhere would be the one thing in here that lies about what it does.
 *
 * /characters redirects to /inventory (see next.config), so old links keep working.
 *
 * The Wallet and People are deliberately absent from the list. They are reached from the pages that
 * name the thing they edit, which is where you already are when you want them, and six entries
 * under one heading had stopped being a menu and started being a list of every page.
 *
 * The Drop Log was absent for that reason too. It is listed because it stopped being a Party View
 * page: it holds what fell on bosses that have no party, and it is where those are logged. Reaching
 * it through parties would mean going through parties to see drops that are not theirs.
 */
export const SECTIONS: { group?: string; items: SectionItem[] }[] = [
  {
    items: [{ href: "/characters", label: "Characters" }],
  },
  {
    group: "Bossing",
    items: [
      { href: "/bosses", label: "Individual View" },
      { href: "/bosses/parties", label: "Party View" },
      // Reached from the party editor and from Run Order, so it needs matching but not listing.
      // The Wallet needs neither: it sits under /bosses/parties and so already resolves to Party
      // View, which is the section it is part of.
      { href: "/bosses/people", label: "Edit People", hidden: true },
      { href: "/bosses/drops", label: "Drop Log" },
      { href: "/bosses/order", label: "Run Order" },
      { href: "/bosses/split", label: "Split Utility", interactiveOnly: true },
    ],
  },
  {
    items: [{ href: "/inventory", label: "Inventory" }],
  },
];

/**
 * What the welcome-back screen offers, in the order it draws them.
 *
 * A way in, not a second copy of the menu: Run Order and the Split Utility are reached from the
 * hamburger like everything else. Labels are looked up in SECTIONS rather than written
 * again, so a section renamed there cannot keep its old name here.
 */
export const HOME_HREFS = [
  "/characters",
  "/inventory",
  "/bosses",
  "/bosses/parties",
  "/bosses/drops",
];

/** Resolved at import, so a stale href fails the build's tests rather than a user's click. */
export const HOME_ACTIONS: SectionItem[] = HOME_HREFS.map((href) => {
  const item = SECTIONS.flatMap((s) => s.items).find((i) => i.href === href);
  if (!item) throw new Error(`No section owns ${href}`);
  return item;
});

/** Every href the menu routes, hidden ones included. Not narrowed by world: routing is not listing. */
export const HREFS = SECTIONS.flatMap((s) => s.items.map((i) => i.href));

/** Only what is on the list. Prefetching a page the menu cannot reach would warm nothing. */
export const MENU_HREFS = SECTIONS.flatMap((s) =>
  s.items.filter((i) => !i.hidden).map((i) => i.href),
);

/**
 * What to draw for the world being shown, or everything while the answer is not known yet.
 *
 * Undefined is the moment before /api/settings answers. Showing the full menu then is the old
 * behaviour and costs a Heroic account one entry for a few milliseconds; the panel does not even
 * mount until the hamburger is clicked, which is almost always after.
 */
export function sectionsFor(trades: boolean | undefined) {
  if (trades !== false) return SECTIONS;
  return SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.interactiveOnly),
  })).filter((section) => section.items.length > 0);
}

/**
 * Which entry to light up for this path, or undefined for none.
 *
 * Longest match wins, so /bosses/split lights "Split Utility" alone: a plain startsWith would
 * light "Individual View" too, since one section nests under the other. A hidden href can win,
 * and then nothing is highlighted, which is the point of it winning.
 */
export function activeHref(pathname: string): string | undefined {
  return HREFS.filter((href) => pathname === href || pathname.startsWith(`${href}/`)).sort(
    (a, b) => b.length - a.length,
  )[0];
}
