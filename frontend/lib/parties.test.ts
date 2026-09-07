import { describe, expect, it } from "vitest";
import {
  bossesWithoutConfig,
  byBoss,
  byCharacter,
  configFor,
  consolidate,
  existedInWeek,
  filterByClear,
  guaranteedDrop,
  hasGuaranteedDrop,
  hasStandingRoster,
  isCleared,
  knownCharacterNames,
  namedSeats,
  otherMembers,
  partiedBossKeys,
  partySizeLabel,
  runningThisPeriod,
  standingMembers,
  standingParties,
} from "./parties";
import type { Boss } from "@/types/boss";
import type { Party, PartyMember } from "@/types/party";

const seat = (name: string, characterId: string | null = null): PartyMember => ({
  id: `seat-${name}`,
  name,
  personId: null,
  personName: null,
  characterId,
  linkedCharacterId: null,
  spriteImgUrl: null,
  guest: false,
  shares: 1,
});

const boss = (bossKey: string, name: string): Boss => ({
  bossKey,
  name,
  reset: "WEEKLY",
  iconUrl: `/boss-icons/${bossKey}.png`,
  difficulties: ["NORMAL", "HARD"],
});

const config = (id: string, characterId: string, bossKey: string, others: string[]): Party => ({
  id,
  slug: id,
  characterId,
  solo: false,
  retired: false,
  worldType: "INTERACTIVE",
  bossKey,
  difficulty: null,
  minutes: null,
  members: [seat("mine", characterId), ...others.map((o) => seat(o))],
  seats: [seat("mine", characterId), ...others.map((o) => seat(o))],
  looterMemberId: null,
  usualRoster: true,
  skippedThisPeriod: false,
  oneOff: false,
  pendingLoot: 0,
  awaitingPayout: 0,
  settledLoot: 0,
  cleared: null,
  clearedByHand: false,
  createdAt: "2026-07-26T00:00:00Z",
  updatedAt: "2026-07-26T00:00:00Z",
});

describe("hasStandingRoster", () => {
  const party = config("p1", "c1", "limbo", ["Steve"]);

  it("is false for a one-off, which has no roster under the week", () => {
    // Its people are that week's, so clearing the week reveals nobody rather than a usual party.
    expect(hasStandingRoster({ ...party, oneOff: true })).toBe(false);
  });

  it("is true for an ordinary party, which a week can be reverted to", () => {
    expect(hasStandingRoster(party)).toBe(true);
  });
});

describe("otherMembers", () => {
  it("leaves your own character out, because the config already is that character", () => {
    const party = config("p1", "char-1", "limbo", ["CreedBratton"]);
    expect(otherMembers(party).map((m) => m.name)).toEqual(["CreedBratton"]);
  });
});

describe("standingMembers", () => {
  /** A week that ran with Dwight in Creed's place, the party itself unchanged. */
  const guestWeek = (): Party => {
    const party = config("p1", "char-1", "limbo", ["CreedBratton"]);
    const dwight = { ...seat("Dwight"), guest: true };
    return {
      ...party,
      members: [seat("mine", "char-1"), dwight],
      seats: [...party.seats, dwight],
      usualRoster: false,
    };
  };

  it("is the party, not the week being shown", () => {
    // What the config editor prefills from. Reading the week instead would offer Dwight as a
    // standing member and drop Creed, on a save that was only meant to change the difficulty.
    expect(standingMembers(guestWeek()).map((m) => m.name)).toEqual(["CreedBratton"]);
    expect(otherMembers(guestWeek()).map((m) => m.name)).toEqual(["Dwight"]);
  });
});

describe("partySizeLabel", () => {
  it("uses the words people actually use, and counts past where they run out", () => {
    expect(partySizeLabel(2)).toBe("Duo");
    expect(partySizeLabel(3)).toBe("Trio");
    expect(partySizeLabel(6)).toBe("6-man");
  });
});

describe("existedInWeek", () => {
  const made = (id: string, createdAt: string): Party => ({
    ...config(id, "char-1", "limbo", ["X"]),
    createdAt,
  });

  it("drops a config set up after the week it is being shown under", () => {
    // The bug this exists for: every config was created 26 Jul, and the week of 16 Jul drew all of
    // them, so a clear read off a 19 Jul planner capture was attributed to a party that did not
    // exist for another week, beside a roster that was never that week's.
    const parties = [made("old", "2026-07-14T10:00:00Z"), made("new", "2026-07-26T18:16:49.608Z")];
    expect(existedInWeek(parties, "2026-07-16").map((p) => p.id)).toEqual(["old"]);
  });

  it("keeps a config set up mid-week, which did exist in it", () => {
    expect(existedInWeek([made("p", "2026-07-19T20:33:07Z")], "2026-07-16")).toHaveLength(1);
  });

  it("puts a config created on a reset day in the week that day opens, not the one it closes", () => {
    // Midnight Thursday UTC is the boundary. A config created at any time on 23 Jul belongs to the
    // week of 23 Jul, so the week of 16 Jul must not claim it.
    const onReset = [made("p", "2026-07-23T00:00:00Z")];
    expect(existedInWeek(onReset, "2026-07-16")).toHaveLength(0);
    expect(existedInWeek(onReset, "2026-07-23")).toHaveLength(1);
  });

  it("does not narrow the week a config was made in", () => {
    expect(existedInWeek([made("p", "2026-07-26T00:00:00Z")], "2026-07-23")).toHaveLength(1);
  });
});

describe("filterByClear", () => {
  const cleared = { ...config("p1", "char-1", "limbo", ["X"]), cleared: true };
  const notCleared = { ...config("p2", "char-1", "kalos", ["X"]), cleared: false };
  const unreported = config("p3", "char-1", "baldrix", ["X"]);

  it("keeps everything under all", () => {
    expect(filterByClear([cleared, notCleared, unreported], "all")).toHaveLength(3);
  });

  it("counts an unreported boss as not cleared, not as cleared", () => {
    // The failure this guards: a week where nothing has been captured yet reads as a fully
    // cleared week, and the list of what is left comes back empty.
    expect(isCleared(unreported)).toBe(false);
    expect(
      filterByClear([cleared, notCleared, unreported], "not-cleared").map((p) => p.id),
    ).toEqual(["p2", "p3"]);
    expect(filterByClear([cleared, notCleared, unreported], "cleared").map((p) => p.id)).toEqual([
      "p1",
    ]);
  });
});

describe("runningThisPeriod", () => {
  const on = config("p1", "char-1", "limbo", ["X"]);
  const off = { ...config("p2", "char-1", "kalos", ["X"]), skippedThisPeriod: true };

  it("drops a config taken off the period and keeps the rest", () => {
    expect(runningThisPeriod([on, off]).map((p) => p.id)).toEqual(["p1"]);
  });

  it("counts a boss taken off as neither cleared nor outstanding", () => {
    // The failure this guards: a boss nobody is running this week sits in the "Not Cleared" count
    // for ever, so the number that says what is left to do never reaches zero. Narrowing first is
    // what keeps the tab counts and the rows they promise in agreement.
    const running = runningThisPeriod([on, off]);
    expect(filterByClear(running, "not-cleared")).toHaveLength(1);
    expect(filterByClear(running, "cleared")).toHaveLength(0);
    expect(filterByClear(running, "all")).toHaveLength(1);
  });

  it("leaves a cleared config alone: the two marks are different answers", () => {
    const cleared = { ...config("p3", "char-1", "baldrix", ["X"]), cleared: true };
    expect(runningThisPeriod([cleared]).map((p) => p.id)).toEqual(["p3"]);
  });
});

describe("byCharacter", () => {
  it("groups in roster order and leaves out characters with nothing", () => {
    const a = config("p1", "char-1", "limbo", ["X"]);
    const b = config("p2", "char-2", "limbo", ["Y"]);
    const groups = byCharacter([a, b], ["char-2", "char-1", "char-3"]);

    expect(groups.map((g) => g.key)).toEqual(["char-2", "char-1"]);
    expect(groups[0]?.parties).toEqual([b]);
  });
});

describe("byBoss", () => {
  it("groups in catalog order, with two characters on one boss together", () => {
    const catalog = [boss("limbo", "Limbo"), boss("baldrix", "Baldrix")];
    const mech = config("p1", "char-1", "baldrix", ["X"]);
    const warrior = config("p2", "char-2", "limbo", ["Y"]);
    const third = config("p3", "char-3", "limbo", ["Z"]);

    const groups = byBoss([mech, warrior, third], catalog);
    expect(groups.map((g) => g.key.bossKey)).toEqual(["limbo", "baldrix"]);
    expect(groups[0]?.parties.map((p) => p.id)).toEqual(["p2", "p3"]);
  });
});

describe("consolidate", () => {
  it("merges the same roster across bosses into one arrangement", () => {
    // A duo with CreedBratton on three bosses is one arrangement and three runs. Each keeps its
    // own config, because each has its own loot pool.
    const kalos = config("p1", "char-1", "kalos", ["CreedBratton"]);
    const adversary = config("p2", "char-1", "first-adversary", ["CreedBratton"]);
    const baldrix = config("p3", "char-1", "baldrix", ["CreedBratton"]);

    const merged = consolidate([kalos, adversary, baldrix], ["char-1"]);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.parties.map((p) => p.bossKey)).toEqual([
      "kalos",
      "first-adversary",
      "baldrix",
    ]);
  });

  it("treats the same people in another order as the same arrangement", () => {
    const one = config("p1", "char-1", "kalos", ["Lynn", "Kaiser"]);
    const two = config("p2", "char-1", "limbo", ["kaiser", "lynn"]);
    expect(consolidate([one, two], ["char-1"])).toHaveLength(1);
  });

  it("keeps different rosters and different characters apart", () => {
    const duo = config("p1", "char-1", "kalos", ["CreedBratton"]);
    const trio = config("p2", "char-1", "limbo", ["CreedBratton", "Lynn"]);
    // Same roster, but somebody else's character runs it: two arrangements, because the question
    // is what THIS character runs with.
    const otherCharacter = config("p3", "char-2", "kalos", ["CreedBratton"]);

    expect(consolidate([duo, trio, otherCharacter], ["char-1", "char-2"])).toHaveLength(3);
  });
});

describe("configFor", () => {
  it("finds the config a drop on this character and boss will land in", () => {
    const mine = config("p1", "char-1", "limbo", ["X"]);
    const theirs = config("p2", "char-2", "limbo", ["X"]);

    expect(configFor([mine, theirs], "char-1", "limbo")?.id).toBe("p1");
    expect(configFor([mine, theirs], "char-1", "baldrix")).toBeUndefined();
  });

  it("answers with a retired config, the way the server's own lookup does", () => {
    // partyIdFor does not filter on standing, so this must not either: a retired config still holds
    // the pair's slot and a drop logged on the pair lands in it, split by the roster it kept. A form
    // that could not see it would say nothing about a party that has ended.
    const gone = { ...config("p1", "char-1", "limbo", ["X"]), retired: true };

    expect(configFor([gone], "char-1", "limbo")?.retired).toBe(true);
  });
});

describe("bossesWithoutConfig", () => {
  it("offers only the bosses this character has no config for yet", () => {
    // One config per character per boss, so the ones already taken cannot be added again. That is
    // the same rule the server enforces, kept off the dropdown rather than shown as an error.
    const catalog = [boss("limbo", "Limbo"), boss("baldrix", "Baldrix")];
    const taken = config("p1", "char-1", "limbo", ["X"]);

    expect(bossesWithoutConfig([taken], catalog, "char-1").map((b) => b.bossKey)).toEqual([
      "baldrix",
    ]);
    // Another character of yours can still run it.
    expect(bossesWithoutConfig([taken], catalog, "char-2").map((b) => b.bossKey)).toEqual([
      "limbo",
      "baldrix",
    ]);
  });

  it("offers a boss again once its one-off period has passed", () => {
    // The config is still there, holding the pair's slot for its pool and the week it ran. Leaving
    // the boss off the dropdown would make a boss you ran once unrunnable ever again.
    const catalog = [boss("limbo", "Limbo"), boss("baldrix", "Baldrix")];
    const spent = {
      ...config("p1", "char-1", "limbo", ["X"]),
      oneOff: true,
      skippedThisPeriod: true,
    };

    expect(bossesWithoutConfig([spent], catalog, "char-1").map((b) => b.bossKey)).toEqual([
      "limbo",
      "baldrix",
    ]);
  });

  it("does NOT offer a standing party that is merely off this week", () => {
    // It has a roster and a difficulty and is on again next period. Adding over it would overwrite
    // both, so the way back to it is the put-back button rather than the dropdown.
    const catalog = [boss("limbo", "Limbo"), boss("baldrix", "Baldrix")];
    const off = { ...config("p1", "char-1", "limbo", ["X"]), skippedThisPeriod: true };

    expect(bossesWithoutConfig([off], catalog, "char-1").map((b) => b.bossKey)).toEqual([
      "baldrix",
    ]);
  });

  it("still hides a one-off that is on this period", () => {
    const catalog = [boss("limbo", "Limbo"), boss("baldrix", "Baldrix")];
    const live = { ...config("p1", "char-1", "limbo", ["X"]), oneOff: true };

    expect(bossesWithoutConfig([live], catalog, "char-1").map((b) => b.bossKey)).toEqual([
      "baldrix",
    ]);
  });
});

describe("standingParties", () => {
  it("leaves out the one-offs, which nobody set up and nobody has to take off", () => {
    const standing = config("p1", "char-1", "limbo", ["X"]);
    const tonight = { ...config("p2", "char-1", "baldrix", ["Y"]), oneOff: true };

    expect(standingParties([standing, tonight]).map((p) => p.id)).toEqual(["p1"]);
  });

  it("offers a one-off's boss for a standing party, since its row is not there to say so", () => {
    // What the edit page does with the two together. Refusing the boss would leave the select
    // silently short of it, with the row that explains the absence on another page.
    const catalog = [boss("limbo", "Limbo"), boss("baldrix", "Baldrix")];
    const tonight = { ...config("p1", "char-1", "limbo", ["X"]), oneOff: true };

    expect(
      bossesWithoutConfig(standingParties([tonight]), catalog, "char-1").map((b) => b.bossKey),
    ).toEqual(["limbo", "baldrix"]);
  });
});

describe("knownCharacterNames", () => {
  it("gathers every name the app has seen, from all three places it keeps them", () => {
    // The datalist behind both roster editors. A seat is matched to its existing row by NAME, so a
    // spelling that misses abandons that seat and makes a second one: this is what stops it.
    const names = knownCharacterNames(
      [{ name: "mechyfechy" }],
      [{ characters: ["CreedBratton", "Cara"] }],
      [config("p1", "char-1", "limbo", ["Bob"])],
    );

    // Sorted and deduplicated: "mine" is the config's own seat, and it is a name like any other.
    expect(names).toEqual(["Bob", "Cara", "CreedBratton", "mechyfechy", "mine"]);
  });

  it("says the same name once, however many parties it sits in", () => {
    const twice = [
      config("p1", "char-1", "limbo", ["Bob"]),
      config("p2", "char-1", "baldrix", ["Bob"]),
    ];

    expect(knownCharacterNames([], [], twice).filter((n) => n === "Bob")).toHaveLength(1);
  });
});

describe("guaranteedDrop", () => {
  const coupon = {
    dropKey: "vestige-of-erion",
    name: "Vestige of Erion Coupon",
    iconUrl: "/drop-icons/vestige-of-erion.png",
    perMember: null,
    worlds: null,
    quantity: 1,
    fungible: false,
    untradeable: false,
    pieces: { INTERACTIVE: { EXTREME: 180 } },
    bundles: { INTERACTIVE: { EXTREME: 6 } },
  };
  const grindstone = {
    ...coupon,
    dropKey: "grindstone-of-faith",
    name: "Grindstone",
    fungible: true,
    untradeable: false,
    pieces: {},
    bundles: {},
  };

  it("names the drop this boss gives for certain at the mode being run", () => {
    expect(guaranteedDrop([grindstone, coupon], "EXTREME", "INTERACTIVE")?.dropKey).toBe(
      "vestige-of-erion",
    );
  });

  it("says nothing at a difficulty that drops none of it", () => {
    // Extreme Kalos gives 180 and Chaos Kalos none, so the marker is not a property of the boss
    // alone.
    expect(guaranteedDrop([grindstone, coupon], "CHAOS", "INTERACTIVE")).toBeNull();
  });

  it("says nothing when nobody has recorded a difficulty, or there is no table", () => {
    expect(guaranteedDrop([grindstone, coupon], null, "INTERACTIVE")).toBeNull();
    expect(guaranteedDrop(undefined, "EXTREME", "INTERACTIVE")).toBeNull();
  });

  // Which bosses the routine list asks a mode for. A boss whose table carries an amount at some mode
  // has something a clear can file once the mode is known; on every other boss the select would be a
  // control that changes nothing, so it is not drawn.
  it("knows a boss whose clear can file something, before any mode is chosen", () => {
    expect(hasGuaranteedDrop([grindstone, coupon])).toBe(true);
    expect(hasGuaranteedDrop([grindstone])).toBe(false);
    expect(hasGuaranteedDrop([])).toBe(false);
    expect(hasGuaranteedDrop(undefined)).toBe(false);
  });

  it("reads a row that predates the pieces field as carrying no amount", () => {
    // lib/cache.ts hands back whatever shape the API had when the page last fetched, so a tab open
    // across a deploy gets a drop with no `pieces` at all rather than an empty one.
    const old = { ...grindstone, pieces: undefined } as unknown as typeof grindstone;
    expect(hasGuaranteedDrop([old])).toBe(false);
  });
});

describe("partiedBossKeys", () => {
  it("locks a boss this character has a standing party for", () => {
    const party = config("p1", "char-1", "limbo", ["CreedBratton"]);

    expect(Array.from(partiedBossKeys([party], "char-1"))).toEqual(["limbo"]);
    // Another character of yours runs it alone until somebody says otherwise.
    expect(Array.from(partiedBossKeys([party], "char-2"))).toEqual([]);
  });

  it("does not lock a solo pool", () => {
    // A pool holding what fell on a boss run alone is not a party, and there would be nothing to
    // remove first: the box would never come back.
    const pool = { ...config("p1", "char-1", "limbo", []), solo: true };

    expect(Array.from(partiedBossKeys([pool], "char-1"))).toEqual([]);
  });

  it("does not lock a one-off whose period has passed", () => {
    // One night with people who are not who this character runs the boss with. The config stays
    // for its pool and its week, but the boss is soloed again now, so the box has to untick.
    const spent = {
      ...config("p1", "char-1", "baldrix", ["Bryants", "CreedBratton"]),
      oneOff: true,
      skippedThisPeriod: true,
    };

    expect(Array.from(partiedBossKeys([spent], "char-1"))).toEqual([]);
  });

  it("locks a one-off that is on this period", () => {
    // Armed for the period the page is showing, so this period it IS who they run it with.
    const live = { ...config("p1", "char-1", "jupiter", ["Bryants"]), oneOff: true };

    expect(Array.from(partiedBossKeys([live], "char-1"))).toEqual(["jupiter"]);
  });
});

describe("namedSeats", () => {
  it("keeps the order the roster was typed in", () => {
    // Seat order is position, and position is what the boxes are: writeMembers takes the list as
    // sent, so a roster that reordered itself on the way out would draw back in a different order.
    expect(namedSeats(["Bryants", "CreedBratton", "mechyfechy"])).toEqual([
      "Bryants",
      "CreedBratton",
      "mechyfechy",
    ]);
  });

  it("drops a seat nobody filled in", () => {
    // "+ Member" adds an empty box. Sending it would be refused ("a member needs a character
    // name"), which would make adding a seat and changing your mind an error to read.
    expect(namedSeats(["Bryants", "", "CreedBratton"])).toEqual(["Bryants", "CreedBratton"]);
  });

  it("drops a box holding only spaces", () => {
    expect(namedSeats(["Bryants", "   "])).toEqual(["Bryants"]);
  });

  it("trims a name, because a seat is matched by one", () => {
    // writeMembers matches an existing seat by trimmed name. " Bryants" would abandon Bryants'
    // seat and make a second one, taking the payouts pointing at it out of the roster.
    expect(namedSeats([" Bryants ", "CreedBratton "])).toEqual(["Bryants", "CreedBratton"]);
  });

  it("says nobody for a roster of empty boxes", () => {
    // What an untouched card holds. The caller uses this to keep the + off rather than to send it:
    // creating a party naming nobody is refused, on purpose.
    expect(namedSeats([""])).toEqual([]);
    expect(namedSeats(["", "", ""])).toEqual([]);
  });

  it("leaves the same character twice for the server to refuse", () => {
    // Not deduped here. The server's "the same character twice" is the message that says what
    // happened; silently dropping one would file a night as a smaller party than was typed, and
    // divide the drop by it.
    expect(namedSeats(["Bryants", "bryants"])).toEqual(["Bryants", "bryants"]);
  });
});
