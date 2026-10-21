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
//   - money the owner SENT them out of a sale of their coupons is a payment from the owner. One they
//     offset needs no row: the reader's book counts that money against the owner already.
// Written as the reader's own (no recorded_by): it is their book, theirs to change.

internal class MoneyRow(
    val amount: Long,
    val note: String?,
    val at: Instant,
)

internal class TrancheRow(
    /** True when the owner's own pile sold it; false when it was the reader's. */
    val ownersPile: Boolean,
    val pieces: Int,
    val disposition: String,
    val amount: Long?,
    val soldAt: Instant,
    /** Pieces of it that were the OTHER side's: the reader's on the owner's pile, and the other way. */
    val otherSides: Int,
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
    /** The reader's decisions to write: their sales of the owner's coupons, offset. See coupon money below. */
    val offsets: List<MoneyRow>,
) {
    fun isEmpty() = debts.isEmpty() && payments.isEmpty() && tranches.isEmpty() && closures.isEmpty()
}

/**
 * One side's share of a priced sale, as saleCredits in lib/vestige-ledger.ts rounds it: to the meso,
 * half up. Integer arithmetic, so the two cannot disagree by a float.
 */
internal fun shareOfSale(
    sharePieces: Int,
    amount: Long,
    pieces: Int,
): Long = (2 * sharePieces * amount + pieces) / (2L * pieces)

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
    // Their coupon money the owner sent them. See the file comment for why an offset is not here.
    val sent =
        VestigeProceedsDisposal
            .selectAll()
            .where {
                (VestigeProceedsDisposal.userId eq owner) and (VestigeProceedsDisposal.personId eq person) and
                    (VestigeProceedsDisposal.kind eq "PAID")
            }.map {
                MoneyRow(
                    -it[VestigeProceedsDisposal.amount],
                    "coupon money sent",
                    it[VestigeProceedsDisposal.decidedAt],
                )
            }
    val tranches = readTranches(owner, person)
    val decided =
        VestigeProceedsDisposal
            .selectAll()
            .where { (VestigeProceedsDisposal.userId eq owner) and (VestigeProceedsDisposal.personId eq person) }
            .sumOf { it[VestigeProceedsDisposal.amount] }
    val money = couponMoney(tranches, decided)
    return SharedMoney(debts + money.held, payments + sent, tranches, readClosures(owner, person), money.offsets)
}

private class CouponMoney(
    val held: List<MoneyRow>,
    val offsets: List<MoneyRow>,
)

/**
 * Coupon money, which the two books count differently, so the copy says what the owner's book did.
 *
 * The holder of the money decides about it (V61): until they do it is outside the net. So:
 *  - the reader's pile sold the owner's coupons: the OWNER's book counts that money in what the
 *    reader owes. In the reader's book it is money they hold, undecided, so the copy records the
 *    decision the owner's book already assumed: offset;
 *  - the owner's pile sold the reader's coupons and the owner has not decided all of it: the
 *    owner's book holds the rest outside the net, and the reader's would count it in, so the copy
 *    says the owner still holds it, as an entry they can take back once it is settled.
 */
private fun couponMoney(
    tranches: List<TrancheRow>,
    decided: Long,
): CouponMoney {
    val priced = tranches.filter { it.amount != null && it.pieces > 0 && it.otherSides > 0 }
    val offsets =
        priced
            .filter { !it.ownersPile }
            .map { MoneyRow(shareOfSale(it.otherSides, it.amount!!, it.pieces), null, it.soldAt) }
    val owed = priced.filter { it.ownersPile }.sumOf { shareOfSale(it.otherSides, it.amount!!, it.pieces) }
    val stillHeld = owed - minOf(owed, decided)
    // Written negated, like every debt here: what the reader is owed less of, until it is decided.
    val held =
        if (stillHeld >
            0
        ) {
            listOf(MoneyRow(stillHeld, "coupon money they still hold", priced.maxOf { it.soldAt }))
        } else {
            emptyList()
        }
    return CouponMoney(held, offsets)
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
    for (offset in money.offsets) {
        VestigeProceedsDisposal.insert {
            it[id] = Uuid.random()
            it[userId] = reader
            it[holderKind] = PERSON
            it[personId] = person
            it[characterName] = null
            it[amount] = offset.amount
            it[kind] = "OFFSET"
            it[decidedAt] = offset.at
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
    if (tranche.otherSides == 0) return
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
