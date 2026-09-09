// Mirrors backend's pages/DropLogPageRoutes.kt DropLogPageResponse field-for-field.

import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { DropTables } from "@/types/drop";
import type { PartyLootPool } from "@/types/loot";
import type { Party, Person } from "@/types/party";
import type {
  ProceedsDisposal,
  SettlementDebt,
  VestigePayment,
  VestigeSettlement,
  VestigeTranche,
} from "@/types/vestige";

/**
 * Everything the Drop Log draws, from one request.
 *
 * Eleven reads, and eleven requests, for one screen. Not a round trip problem (prod is HTTP/2, so
 * they went out together), a CPU one: eleven JWT verifications, `ensureUser` upserts,
 * `inActiveWorld` lookups, transactions and JSON payloads on a 2-vCPU box where postgres measured
 * 4% and everything else 133% of the 200% available.
 *
 * The individual endpoints still exist and other pages still read them. This is the Drop Log's
 * convenience, not a replacement for the resources underneath it.
 */
export type DropLogPage = {
  parties: Party[];
  pools: PartyLootPool[];
  tranches: VestigeTranche[];
  payments: VestigePayment[];
  settlements: VestigeSettlement[];
  debts: SettlementDebt[];
  disposals: ProceedsDisposal[];
  bosses: Boss[];
  drops: DropTables;
  characters: Character[];
  people: Person[];
};
