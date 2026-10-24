package com.sharpeyes.money

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

// The money port's inputs: the frontend's types/*.ts, field for field, as the page endpoints serve
// them. Read off the served JSON rather than off the backend's response classes, so the port sees
// exactly what the browser sees. Every number is a Double, as it is in JavaScript (see Js.kt).
// A field the TypeScript marks optional is nullable here with a null default: absent and null are
// the same answer to every reader in the port.

/** How the port reads and writes JSON. Lenient on input, which may come from an older payload. */
val moneyJson =
    Json {
        ignoreUnknownKeys = true
        explicitNulls = false
        encodeDefaults = true
    }

@Serializable
data class Holder(
    /** PERSON, SELF or CHARACTER. */
    val kind: String,
    val personId: String? = null,
    val characterName: String? = null,
)

@Serializable
data class LootPayout(
    val memberId: String,
    val paid: Boolean,
    val paidAt: String? = null,
    val shares: Double = 1.0,
)

@Serializable
data class LootBundle(
    val memberId: String,
    val bundles: Double,
)

@Serializable
data class Loot(
    val id: String,
    val dropKey: String? = null,
    val customName: String? = null,
    val name: String,
    val iconUrl: String? = null,
    val perMember: String? = null,
    val bossKey: String? = null,
    val quantity: Double,
    val difficulty: String? = null,
    val droppedOn: String,
    val weekStart: String,
    val status: String,
    val saleAmount: Double? = null,
    val saleUsdCents: Double? = null,
    val amountBasis: String? = null,
    val splitMethod: String? = null,
    val sellerShares: Double? = null,
    val sellerMemberId: String? = null,
    val takenByMemberId: String? = null,
    val solo: Boolean? = null,
    val soldAt: String? = null,
    val recordedByYou: Boolean? = null,
    val recordedByName: String? = null,
    val recordedAt: String? = null,
    val payouts: List<LootPayout> = emptyList(),
    val ranThatWeek: List<String> = emptyList(),
    val sharesThatWeek: Map<String, Double>? = null,
    val bundles: Double? = null,
    val bundlesBy: List<LootBundle>? = null,
)

@Serializable
data class PartyLootPool(
    val partyId: String,
    val loot: List<Loot>,
)

@Serializable
data class PartyMember(
    val id: String,
    val name: String,
    val personId: String? = null,
    val personName: String? = null,
    val characterId: String? = null,
    val linkedCharacterId: String? = null,
    val spriteImgUrl: String? = null,
    val guest: Boolean = false,
    val shares: Double = 1.0,
    val pieceShares: Double? = null,
)

@Serializable
data class Party(
    val id: String,
    val slug: String = "",
    val characterId: String,
    val solo: Boolean = false,
    val oneOff: Boolean = false,
    val retired: Boolean = false,
    val worldType: String = "INTERACTIVE",
    val bossKey: String,
    val difficulty: String? = null,
    val weekDifficulty: String? = null,
    val minutes: Double? = null,
    val members: List<PartyMember> = emptyList(),
    val seats: List<PartyMember> = emptyList(),
    val yours: Boolean? = null,
)

@Serializable
data class Person(
    val id: String,
    val name: String,
    val characters: List<String> = emptyList(),
    val ownedCharacters: List<String> = emptyList(),
    val linked: Boolean = false,
    val image: String? = null,
    val pinned: Boolean = false,
)

@Serializable
data class Boss(
    val bossKey: String,
    val name: String,
    val reset: String = "WEEKLY",
    val iconUrl: String? = null,
    val difficulties: List<String> = emptyList(),
)

@Serializable
data class BossDrop(
    val dropKey: String,
    val name: String,
    val iconUrl: String? = null,
    val perMember: String? = null,
    val worlds: String? = null,
    val quantity: Double = 1.0,
    val fungible: Boolean = false,
    val pieces: Map<String, Map<String, Double>> = emptyMap(),
    val bundles: Map<String, Map<String, Double>> = emptyMap(),
)

@Serializable
data class TrancheShare(
    val holder: Holder,
    val pieces: Double,
)

@Serializable
data class VestigeTranche(
    val id: String,
    val holder: Holder,
    val pieces: Double,
    val amount: Double? = null,
    val disposition: String? = null,
    val shares: List<TrancheShare>? = null,
    val soldAt: String? = null,
    val recordedByYou: Boolean? = null,
    val recordedByName: String? = null,
)

@Serializable
data class VestigePayment(
    val id: String,
    val holder: Holder,
    val amount: Double,
    val note: String? = null,
    val receivedAt: String,
    val recordedByYou: Boolean? = null,
    val recordedByName: String? = null,
)

@Serializable
data class VestigeSettlement(
    val id: String,
    val holder: Holder,
    val lootIds: List<String>,
    val unpaid: Double,
    val settledAt: String,
)

@Serializable
data class SettlementDebtPayout(
    val lootId: String,
    val memberId: String,
)

@Serializable
data class SettlementDebt(
    val id: String,
    val holder: Holder,
    val amount: Double,
    val note: String? = null,
    val payouts: List<SettlementDebtPayout> = emptyList(),
    val incurredAt: String,
    val recordedByYou: Boolean? = null,
    val recordedByName: String? = null,
)

@Serializable
data class ProceedsDisposal(
    val id: String,
    val holder: Holder,
    val amount: Double,
    /** OFFSET or PAID. */
    val kind: String,
    val decidedAt: String,
    /** YOU or THEM. Absent is YOU, a row from before V91. */
    val heldBy: String? = null,
    val recordedByYou: Boolean? = null,
    val recordedByName: String? = null,
)

/** GET /api/pages/drop-log, as far as the money reads it. */
@Serializable
data class DropLogPage(
    val parties: List<Party> = emptyList(),
    val pools: List<PartyLootPool> = emptyList(),
    val tranches: List<VestigeTranche> = emptyList(),
    val payments: List<VestigePayment> = emptyList(),
    val settlements: List<VestigeSettlement> = emptyList(),
    val debts: List<SettlementDebt> = emptyList(),
    val disposals: List<ProceedsDisposal> = emptyList(),
    val bosses: List<Boss> = emptyList(),
    val drops: Map<String, List<BossDrop>> = emptyMap(),
    val people: List<Person> = emptyList(),
)

/** One owner's book, cut to what it says between them and you. GET /api/pages/shared-books. */
@Serializable
data class SharedBook(
    val ownerName: String,
    val ownerImage: String? = null,
    val personId: String,
    val ownerPersonId: String? = null,
    val parties: List<Party> = emptyList(),
    val pools: List<PartyLootPool> = emptyList(),
    val tranches: List<VestigeTranche> = emptyList(),
    val payments: List<VestigePayment> = emptyList(),
    val settlements: List<VestigeSettlement> = emptyList(),
    val debts: List<SettlementDebt> = emptyList(),
    val disposals: List<ProceedsDisposal> = emptyList(),
)
