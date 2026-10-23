package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.SettlementDebt
import com.sharpeyes.backend.db.VestigePayment
import com.sharpeyes.backend.db.VestigeProceedsDisposal
import com.sharpeyes.backend.db.VestigeSettlement
import com.sharpeyes.backend.db.VestigeSettlementLoot
import com.sharpeyes.backend.db.VestigeTranche
import com.sharpeyes.backend.db.VestigeTrancheShare
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The money half of an unlink's snapshot: what the owner's book says between the two of them,
// written into the reader's book the other way round. See SharedSlice.kt.
//
// FLIPPED, row for row, so the reader's card reads off its own book what it read off the owner's:
//   - a debt or a payment changes sign (V89 lets a payment run either way);
//   - an OFFSET becomes a plain entry: it marked the owner's shares paid, which the copied payouts
//     already say, and took the same amount off the reader's debt, which is the entry;
//   - a coupon sale and a closing swap holders, the owner's pile becoming the person's and the
//     reader's pile becoming SELF. A share of a sale naming somebody else is left behind: they are
//     the owner's people, not the reader's;
//   - a decision about coupon money (V61) keeps its kind and swaps whose hands the money is in (V91).
// Written as the reader's own (no recorded_by): it is their book, theirs to change.

internal class MoneyRow(
    val amount: Long,
    val note: String?,
    val at: Instant,
)

internal class TrancheRow(
    /** True when the owner's own pile sold it; false when it was the reader's. */
    val ownersPile: Boolean,
    val pieces: Double,
    val disposition: String,
    val amount: Long?,
    val soldAt: Instant,
    /** Pieces of it that were the OTHER side's: the reader's on the owner's pile, and the other way. */
    val otherSides: Double,
)

internal class Decision(
    val amount: Long,
    val kind: String,
    /** In the READER's terms, already flipped. */
    val heldBy: String,
    val at: Instant,
)

internal class ClosureRow(
    val ownersPile: Boolean,
    val unpaid: Long,
    val settledAt: Instant,
    val lootIds: List<Uuid>,
)

internal class SharedMoney(
    val debts: List<MoneyRow>,
    val payments: List<MoneyRow>,
    val tranches: List<TrancheRow>,
    val closures: List<ClosureRow>,
    /** The reader's decisions about the owner's money they hold, to write as theirs. See V91. */
    val decisions: List<Decision>,
) {
    fun isEmpty() = debts.isEmpty() && payments.isEmpty() && tranches.isEmpty() && closures.isEmpty()
}

/** What [owner]'s book files under [person], and the coupon acts between the two piles. */
internal fun readMoney(
    owner: String,
    person: Uuid?,
): SharedMoney {
    if (person == null) return SharedMoney(emptyList(), emptyList(), emptyList(), emptyList(), emptyList())
    val debts =
        SettlementDebt
            .selectAll()
            .where { (SettlementDebt.userId eq owner) and (SettlementDebt.personId eq person) }
            .map { MoneyRow(it[SettlementDebt.amount], it[SettlementDebt.note], it[SettlementDebt.incurredAt]) }
    val payments =
        VestigePayment
            .selectAll()
            .where { (VestigePayment.userId eq owner) and (VestigePayment.personId eq person) }
            .map { MoneyRow(it[VestigePayment.amount], it[VestigePayment.note], it[VestigePayment.receivedAt]) }
    // Coupon money is held outside the net by whichever side's pile sold it, in both books (V61, V91),
    // so the copied sales need nothing beside them but the decisions, each from the other end.
    val decisions =
        VestigeProceedsDisposal
            .selectAll()
            .where { (VestigeProceedsDisposal.userId eq owner) and (VestigeProceedsDisposal.personId eq person) }
            .map {
                Decision(
                    it[VestigeProceedsDisposal.amount],
                    it[VestigeProceedsDisposal.kind],
                    if (it[VestigeProceedsDisposal.heldBy] == HELD_BY_YOU) HELD_BY_THEM else HELD_BY_YOU,
                    it[VestigeProceedsDisposal.decidedAt],
                )
            }
    return SharedMoney(debts, payments, readTranches(owner, person), readClosures(owner, person), decisions)
}

private fun readTranches(
    owner: String,
    person: Uuid,
): List<TrancheRow> {
    val tranches = VestigeTranche.selectAll().where { VestigeTranche.userId eq owner }.toList()
    val shares =
        VestigeTrancheShare
            .selectAll()
            .where { VestigeTrancheShare.trancheId inList tranches.map { it[VestigeTranche.id] } }
            .groupBy { it[VestigeTrancheShare.trancheId] }
    return tranches.mapNotNull { row ->
        val theirs = shares[row[VestigeTranche.id]].orEmpty()
        val readersPile = row[VestigeTranche.personId] == person
        val ownersPile = row[VestigeTranche.holderKind] == SELF
        // The other side's pieces in it: the owner's in the reader's pile, the reader's in the owner's.
        val other =
            theirs
                .filter {
                    if (readersPile) {
                        it[VestigeTrancheShare.holderKind] == SELF
                    } else {
                        it[VestigeTrancheShare.personId] ==
                            person
                    }
                }.sumOf { it[VestigeTrancheShare.pieces] }
        when {
            readersPile || (ownersPile && other > 0) ->
                TrancheRow(
                    ownersPile = ownersPile,
                    pieces = row[VestigeTranche.pieces],
                    disposition = row[VestigeTranche.disposition],
                    amount = row[VestigeTranche.amount],
                    soldAt = row[VestigeTranche.soldAt],
                    otherSides = other,
                )
            else -> null
        }
    }
}

/** The reader's pile's closings, and the owner's over a drop of the shared parties. */
private fun readClosures(
    owner: String,
    person: Uuid,
): List<ClosureRow> {
    val rows =
        VestigeSettlement
            .selectAll()
            .where { VestigeSettlement.userId eq owner }
            .filter { it[VestigeSettlement.personId] == person || it[VestigeSettlement.holderKind] == SELF }
    val loot =
        VestigeSettlementLoot
            .selectAll()
            .where { VestigeSettlementLoot.settlementId inList rows.map { it[VestigeSettlement.id] } }
            .groupBy({ it[VestigeSettlementLoot.settlementId] }) { it[VestigeSettlementLoot.lootId] }
    return rows.map {
        ClosureRow(
            ownersPile = it[VestigeSettlement.holderKind] == SELF,
            unpaid = it[VestigeSettlement.unpaid],
            settledAt = it[VestigeSettlement.settledAt],
            lootIds = loot[it[VestigeSettlement.id]].orEmpty(),
        )
    }
}

/** [money] into [reader]'s book, filed under [person], drops renamed through [loot]. */
internal fun writeMoney(
    money: SharedMoney,
    reader: String,
    person: Uuid,
    loot: Map<Uuid, Uuid>,
    now: Instant,
) {
    for (debt in money.debts) {
        SettlementDebt.insert {
            it[id] = Uuid.random()
            it[userId] = reader
            it[holderKind] = PERSON
            it[personId] = person
            it[characterName] = null
            it[amount] = -debt.amount
            it[note] = debt.note
            it[incurredAt] = debt.at
            it[createdAt] = now
        }
    }
    for (payment in money.payments) {
        VestigePayment.insert {
            it[id] = Uuid.random()
            it[userId] = reader
            it[holderKind] = PERSON
            it[personId] = person
            it[characterName] = null
            it[amount] = -payment.amount
            it[note] = payment.note
            it[receivedAt] = payment.at
            it[createdAt] = now
        }
    }
    for (decision in money.decisions) {
        VestigeProceedsDisposal.insert {
            it[id] = Uuid.random()
            it[userId] = reader
            it[holderKind] = PERSON
            it[personId] = person
            it[characterName] = null
            it[amount] = decision.amount
            it[kind] = decision.kind
            it[heldBy] = decision.heldBy
            it[decidedAt] = decision.at
            it[createdAt] = now
        }
    }
    money.tranches.forEach { writeTranche(it, reader, person, now) }
    money.closures.forEach { writeClosure(it, reader, person, loot, now) }
}

/** The owner's pile becomes the person's, the reader's becomes SELF, and the other side's share swaps too. */
private fun writeTranche(
    tranche: TrancheRow,
    reader: String,
    person: Uuid,
    now: Instant,
) {
    val id = Uuid.random()
    VestigeTranche.insert {
        it[VestigeTranche.id] = id
        it[userId] = reader
        it[holderKind] = if (tranche.ownersPile) PERSON else SELF
        it[personId] = if (tranche.ownersPile) person else null
        it[characterName] = null
        it[pieces] = tranche.pieces
        it[disposition] = tranche.disposition
        it[amount] = tranche.amount
        it[soldAt] = tranche.soldAt
        it[createdAt] = now
    }
    if (tranche.otherSides <= 0) return
    VestigeTrancheShare.insert {
        it[VestigeTrancheShare.id] = Uuid.random()
        it[trancheId] = id
        it[holderKind] = if (tranche.ownersPile) SELF else PERSON
        it[personId] = if (tranche.ownersPile) null else person
        it[characterName] = null
        it[pieces] = tranche.otherSides
        it[createdAt] = now
    }
}

/** A closing over the copied drops, for the pile on the other side of it now. Nothing copied, nothing closed. */
private fun writeClosure(
    closure: ClosureRow,
    reader: String,
    person: Uuid,
    loot: Map<Uuid, Uuid>,
    now: Instant,
) {
    val copied = closure.lootIds.mapNotNull(loot::get)
    if (copied.isEmpty()) return
    val id = Uuid.random()
    VestigeSettlement.insert {
        it[VestigeSettlement.id] = id
        it[userId] = reader
        it[holderKind] = if (closure.ownersPile) PERSON else SELF
        it[personId] = if (closure.ownersPile) person else null
        it[characterName] = null
        it[unpaid] = closure.unpaid
        it[settledAt] = closure.settledAt
        it[createdAt] = now
    }
    for (lootId in copied) {
        VestigeSettlementLoot.insert {
            it[settlementId] = id
            it[VestigeSettlementLoot.lootId] = lootId
        }
    }
}
