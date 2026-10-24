package com.sharpeyes.money

import kotlinx.serialization.Serializable

// One drop, from the night it fell to the act that closed it. The port of frontend/lib/drop-audit.ts
// and the status words it carries (drop-log.ts, loot.ts).

/** One thing that happened to a drop. Which fields are set depends on [kind]. */
@Serializable
data class AuditEvent(
    /** DROPPED, HELD, SOLD, TAKEN, PAID, OFFSET, SETTLED or OWED. */
    val kind: String,
    val key: String,
    val at: String? = null,
    val boss: String? = null,
    val ranWith: List<String>? = null,
    val other: String? = null,
    val pieces: Double? = null,
    val yours: Boolean? = null,
    val amount: Double? = null,
    val basis: String? = null,
    val seller: String? = null,
    val pooled: Double? = null,
    val yourTake: Double? = null,
    val currency: String? = null,
    val by: String? = null,
    val who: String? = null,
    val writtenOff: Double? = null,
)

@Serializable
data class DropAudit(
    val lootId: String,
    val partyId: String,
    val partySlug: String,
    val partyRetired: Boolean,
    val name: String,
    val iconUrl: String? = null,
    val quantity: Double,
    val yours: Double,
    val boss: String? = null,
    val status: String,
    val stage: String,
    val weekStart: String,
    val character: String? = null,
    val worldType: String,
    val events: List<AuditEvent>,
)

/** Which side of a coupon night you are on, and the other party's name. */
data class CouponSide(
    val name: String,
    val youHold: Boolean,
)

fun couponSide(entry: DropEntry): CouponSide? =
    entry.owedTo?.let { CouponSide(it, true) } ?: entry.owedBy?.let { CouponSide(it, false) }

fun statusLabel(status: String): String =
    when (status) {
        "PENDING" -> "In the pool"
        "SOLD" -> "Awaiting payout"
        "PAID_OUT" -> "Settled"
        "TAKEN" -> "Taken"
        else -> status
    }

fun dropStatusLabel(entry: DropEntry): String =
    when {
        entry.pieces && entry.closed -> "Settled"
        entry.pieces && entry.owedToYou > 0 -> "Owed"
        entry.pieces && entry.owedByYou > 0 -> "To hand over"
        entry.pieces -> "Yours"
        settledForYou(entry) && entry.status == "SOLD" -> statusLabel("PAID_OUT")
        else -> statusLabel(entry.status)
    }

/** Dated events oldest first, then the undated ones in the order they were made. */
private fun inOrder(events: List<AuditEvent>): List<AuditEvent> =
    events.sortedWith { a, b ->
        when {
            a.at == null && b.at == null -> 0
            a.at == null -> 1
            b.at == null -> -1
            else -> localeCompare(a.at, b.at).takeIf { it != 0 } ?: localeCompare(a.key, b.key)
        }
    }

/** What an audit reads besides the drop itself. */
data class AuditBook(
    val entries: List<DropEntry>,
    val pools: List<PartyLootPool>,
    val parties: List<Party>,
    val bossByKey: Map<String, Boss>,
    val settlements: List<VestigeSettlement>,
    val debts: List<SettlementDebt>,
    val names: Map<String, String>,
)

/** The night it fell, who holds its coupons, and how it sold or was taken. */
private fun headEvents(
    entry: DropEntry,
    bossName: String?,
): List<AuditEvent> {
    val events =
        mutableListOf(AuditEvent("DROPPED", "dropped", at = entry.droppedOn, boss = bossName, ranWith = entry.ranWith))
    val side = couponSide(entry)
    if (side != null && (entry.owedToYou > 0 || entry.owedByYou > 0)) {
        val pieces = if (entry.owedToYou > 0) entry.owedToYou else entry.owedByYou
        events += AuditEvent("HELD", "held", other = side.name, pieces = pieces, yours = !side.youHold)
    }
    if (entry.takenByName != null) {
        events += AuditEvent("TAKEN", "taken", by = entry.takenByName)
    } else if (entry.soldAt != null && entry.saleAmount != null) {
        events +=
            AuditEvent(
                "SOLD",
                "sold",
                at = entry.soldAt,
                amount = entry.saleAmount,
                basis = entry.amountBasis,
                seller = entry.sellerName,
                pooled = entry.pooled,
                yourTake = entry.yourTake,
                currency = entry.currency,
            )
    }
    return events
}

/** What became of each share and each closure: offsets, payouts, debts still owed, settlements. */
private fun acts(
    entry: DropEntry,
    loot: Loot,
    party: Party,
    book: AuditBook,
): List<AuditEvent> {
    val payFor = (splitOf(loot, party.seats)?.shares ?: emptyList()).associateBy { it.memberId }
    val nameOf = { h: Holder -> book.names[holderKey(h)] ?: holderKey(h) }
    val out = mutableListOf<AuditEvent>()
    val discharged = HashSet<String>()
    for (debt in book.debts) {
        for (payout in debt.payouts.filter { it.lootId == entry.lootId }) {
            discharged += payout.memberId
            val amount = payFor[payout.memberId]?.pay
            out +=
                AuditEvent(
                    "OFFSET",
                    "offset:${debt.id}:${payout.memberId}",
                    debt.incurredAt,
                    who = nameOf(debt.holder),
                    amount = amount,
                    currency = entry.currency,
                )
        }
    }
    for (payout in loot.payouts.filter { it.memberId !in discharged }) {
        val share = payFor[payout.memberId] ?: continue
        out +=
            if (payout.paid) {
                AuditEvent(
                    "PAID",
                    "paid:${payout.memberId}",
                    payout.paidAt,
                    who = share.name,
                    amount = share.pay,
                    currency = entry.currency,
                )
            } else {
                AuditEvent(
                    "OWED",
                    "owed:${payout.memberId}",
                    who = share.name,
                    amount = share.pay,
                    currency = entry.currency,
                )
            }
    }
    for (act in book.settlements.filter { entry.lootId in it.lootIds }) {
        val closed = act.lootIds.sorted()
        val pieces = if (entry.owedToYou > 0) entry.owedToYou else entry.owedByYou
        val writtenOff = shareOfWriteOff(act.unpaid, closed.size, closed.indexOf(entry.lootId))
        out +=
            AuditEvent(
                "SETTLED",
                "settled:${act.id}",
                act.settledAt,
                who = nameOf(act.holder),
                pieces = pieces,
                writtenOff = writtenOff,
            )
    }
    return out
}

/** One drop's history, or null when the drop or its party is not on the page. */
fun buildDropAudit(
    lootId: String,
    book: AuditBook,
): DropAudit? {
    val entry = book.entries.find { it.lootId == lootId }
    val party = entry?.let { e -> book.parties.find { it.id == e.partyId } }
    val loot =
        entry?.let { e ->
            book.pools
                .find { it.partyId == e.partyId }
                ?.loot
                ?.find { it.id == lootId }
        }
    if (entry == null || party == null || loot == null) return null
    val bossName = book.bossByKey[entry.bossKey ?: ""]?.let { bossLabel(it.name, party.difficulty) }
    return DropAudit(
        lootId = lootId,
        partyId = entry.partyId,
        partySlug = party.slug,
        partyRetired = party.retired,
        name = entry.name,
        iconUrl = entry.iconUrl,
        quantity = entry.quantity,
        yours = entry.yours,
        boss = bossName,
        status = entry.status,
        stage = dropStatusLabel(entry),
        weekStart = entry.weekStart,
        character = party.seats.find { it.characterId == party.characterId }?.name,
        worldType = party.worldType,
        events = headEvents(entry, bossName) + inOrder(acts(entry, loot, party, book)),
    )
}
