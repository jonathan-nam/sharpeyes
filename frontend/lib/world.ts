// Which world you play in, and the three things that follow from it.
//
// Heroic (Reboot) worlds do not trade. Everything downstream of a sale is therefore Interactive
// only: the Auction House cut, the fair/lazy split, the payout roster and the Wallet. The drop log
// is not, a Heroic player still wants to know what fell.
//
// The rules live here rather than in the components so the drop-table flags are read one way in
// one place. Both of them are conditional on the world, and a component that got either backwards
// would show a plausible, confident, wrong count of what a party has to share.

/** As users.world_type, characters.world_type and drop_catalog.worlds all spell them. */
export type WorldType = "INTERACTIVE" | "HEROIC";

export const WORLD_TYPES: WorldType[] = ["INTERACTIVE", "HEROIC"];

/**
 * What to call it on screen.
 *
 * Nexon renamed Reboot to Heroic and players did not follow, so the old name is carried in
 * parentheses rather than picked over the current one.
 */
export function worldLabel(world: WorldType): string {
  return world === "HEROIC" ? "Heroic (Reboot)" : "Interactive";
}

/**
 * The same name where two of them sit side by side.
 *
 * The world toggle carries both worlds at once, and "Heroic (Reboot)" beside "Interactive" is a
 * two-word pill next to a one-word one. The parenthetical is what goes: with both names on screen
 * together, which is which is not in question.
 */
export function worldShortLabel(world: WorldType): string {
  return world === "HEROIC" ? "Heroic" : "Interactive";
}

/** The one you are not in. There are two, so this is total. */
export function otherWorld(world: WorldType): WorldType {
  return world === "HEROIC" ? "INTERACTIVE" : "HEROIC";
}

/** Whether anything in this world can change hands. The gate on every meso figure in the app. */
export function canTrade(world: WorldType): boolean {
  return world === "INTERACTIVE";
}

/**
 * Whether this drop exists in this world.
 *
 * `worlds` is null for every drop in catalog/drops.yaml today, so nothing is narrowed at the
 * moment. The filter stays: a drop that does not exist in Reboot is a pool row that cannot happen.
 */
export function dropExistsIn(worlds: string | null, world: WorldType): boolean {
  return worlds === null || worlds === world;
}

/**
 * Whether to draw meso figures on a screen that answers for the whole account.
 *
 * Takes `trades` from /api/settings, which now follows the world being SHOWN: every account-wide
 * list is narrowed to it server-side, so the account no longer has two worlds' figures to add up
 * and there is nothing left for this to hide. It used to mean "does any character trade", which it
 * had to, back when one screen summed across both.
 *
 * Undefined is the moment before the answer arrives, and it draws them: that is what every screen
 * did before this existed, and it errs towards showing rather than hiding.
 */
export function showsMoney(trades: boolean | undefined): boolean {
  return trades !== false;
}

/**
 * Whether every member receives their own copy, so there is no one pot to divide.
 *
 * ALWAYS means everywhere. HEROIC means the party gets one in Interactive worlds and one each in
 * Heroic, which is the whole reason this takes a world: with one in hand the answer is yes or no,
 * not "it depends where you are".
 */
export function isPerMember(perMember: string | null, world: WorldType): boolean {
  return perMember === "ALWAYS" || (perMember === "HEROIC" && world === "HEROIC");
}
