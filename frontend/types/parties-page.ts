// Mirrors backend's pages/PartiesPageResponse.kt field-for-field, both halves.

import type { Boss, BossClearsView } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { PartyLootPool } from "@/types/loot";
import type { Party, Person, SeatedParty } from "@/types/party";
import type { VestigeSettlement } from "@/types/vestige";

/**
 * What Party View cannot draw without.
 *
 * Two requests rather than one, and the split is the point. The page made nine requests on load
 * and SIX were `.catch(() => null)`, each with a comment saying what degrades without it. One
 * request for all nine would trade that for latency, since any read failing would fail the page,
 * and per-field recovery inside one request does not work either: Postgres aborts a transaction on
 * a failed statement.
 *
 * This one failing blanks the page, exactly as the party list failing already did.
 */
export type PartiesPage = {
  parties: Party[];
  bosses: Boss[];
  characters: Character[];
};

/**
 * The reads the page is built to survive losing.
 *
 * They degrade together now, where before each could fail alone. Six requests become one, so one
 * failure costs all six features rather than one. None of them blanks the page, which is the
 * property those six comments were protecting.
 */
export type PartiesExtras = {
  clears: BossClearsView;
  drops: DropTables;
  people: Person[];
  pools: PartyLootPool[];
  settlements: VestigeSettlement[];
  seated: SeatedParty[];
};
