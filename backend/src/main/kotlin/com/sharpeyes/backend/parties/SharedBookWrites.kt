package com.sharpeyes.backend.parties

import com.sharpeyes.api.vestige.VestigeHolder
import com.sharpeyes.api.vestige.VestigeTrancheShareRow
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.SettlementDebt
import com.sharpeyes.backend.db.VestigePayment
import com.sharpeyes.backend.db.VestigeProceedsDisposal
import com.sharpeyes.backend.db.VestigeTranche
import com.sharpeyes.backend.db.VestigeTrancheShare
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Shared bookkeeping: between two linked accounts there is one book, the party owner's, and the
// member writes into it too. Every row says who wrote it (V88), each side takes back only its own,
// and the member writes only as their own pile in it, the person row the owner keeps for them.
// The checks are the owner's routes' own. Inside a transaction, like the rest.

/** The owner's book a member writes into: whose it is, and the member's person row in it. */
internal data class SharedBook(
    val owner: String,
    val personId: Uuid,
) {
    val holder get() = VestigeHolder(kind = PERSON, personId = personId.toString())
}

/** The book behind [personId] when it is [member]'s person row on somebody else's account. */
internal fun sharedBookAt(
    personId: Uuid,
    member: String,
): SharedBook? =
    Person
        .selectAll()
        .where { (Person.id eq personId) and (Person.linkedUserId eq member) }
        .firstOrNull()
        ?.takeIf { it[Person.userId] != member }
        ?.let { SharedBook(it[Person.userId], personId) }

/**
 * Why [userId] may not file a row against [personId] in their OWN book, or null.
 *
 * When that person's account keeps a shared book with [userId] (owns a party seating one of their
 * characters), the row belongs there: two books holding one debt is the double count this exists to
 * stop. The card offers that book instead.
 */
internal fun ownBookRefusal(
    userId: String,
    personId: Uuid?,
): String? {
    val person =
        personId?.let { id ->
            Person.selectAll().where { (Person.id eq id) and (Person.userId eq userId) }.firstOrNull()
        }
    val other = person?.get(Person.linkedUserId) ?: return null
    val mine = Characters.selectAll().where { Characters.userId eq userId }.map { it[Characters.id] }
    val keeps =
        mine.isNotEmpty() &&
            !PartyMember
                .join(Party, JoinType.INNER, PartyMember.partyId, Party.id)
                .selectAll()
                .where { (Party.userId eq other) and (PartyMember.linkedCharacterId inList mine) }
                .empty()
    return if (keeps) "${person[Person.name]} keeps your shared book. Reload and pick them again." else null
}

internal fun insertSharedTranche(
    book: SharedBook,
    writer: String,
    entry: TrancheEntry,
    now: Instant,
) {
    val trancheId = Uuid.random()
    VestigeTranche.insert {
        it[id] = trancheId
        it[userId] = book.owner
        it[holderKind] = PERSON
        it[personId] = book.personId
        it[pieces] = entry.pieces
        it[amount] = entry.amount
        it[disposition] = entry.disposition
        it[soldAt] = now
        it[createdAt] = now
        it[recordedByUserId] = writer
    }
    entry.shares.forEach { share ->
        VestigeTrancheShare.insert {
            it[id] = Uuid.random()
            it[VestigeTrancheShare.trancheId] = trancheId
            it[holderKind] = share.holder.kind
            it[personId] = share.holder.personId?.let(Uuid::parseOrNull)
            it[characterName] = share.holder.characterName
            it[pieces] = share.pieces
            it[createdAt] = now
        }
    }
}

/** A tranche as typed, already checked. */
internal data class TrancheEntry(
    val pieces: Double,
    val amount: Long?,
    val disposition: String,
    val shares: List<VestigeTrancheShareRow>,
)

/** A debt in the owner's terms: positive is the member owing the owner. */
internal fun insertSharedDebt(
    book: SharedBook,
    writer: String,
    amount: Long,
    note: String?,
    now: Instant,
) {
    SettlementDebt.insert {
        it[id] = Uuid.random()
        it[userId] = book.owner
        it[holderKind] = PERSON
        it[personId] = book.personId
        it[SettlementDebt.amount] = amount
        it[SettlementDebt.note] = note
        it[incurredAt] = now
        it[createdAt] = now
        it[recordedByUserId] = writer
    }
}

/** Mesos the member sent the owner: a payment from their pile, as the owner's book keeps one. */
internal fun insertSharedPayment(
    book: SharedBook,
    writer: String,
    amount: Long,
    note: String?,
    now: Instant,
) {
    VestigePayment.insert {
        it[id] = Uuid.random()
        it[userId] = book.owner
        it[holderKind] = PERSON
        it[personId] = book.personId
        it[VestigePayment.amount] = amount
        it[VestigePayment.note] = note
        it[receivedAt] = now
        it[createdAt] = now
        it[recordedByUserId] = writer
    }
}

/**
 * The member's decision about coupon money between them: [heldBy] in the owner's terms, so THEM is
 * the member holding the owner's money.
 */
internal fun insertSharedDisposal(
    book: SharedBook,
    writer: String,
    amount: Long,
    kind: String,
    heldBy: String,
    now: Instant,
) {
    VestigeProceedsDisposal.insert {
        it[id] = Uuid.random()
        it[userId] = book.owner
        it[holderKind] = PERSON
        it[personId] = book.personId
        it[VestigeProceedsDisposal.amount] = amount
        it[VestigeProceedsDisposal.kind] = kind
        it[VestigeProceedsDisposal.heldBy] = heldBy
        it[decidedAt] = now
        it[createdAt] = now
        it[recordedByUserId] = writer
    }
}

/** Takes back one row [writer] wrote into [book]. False when there is no such row of theirs. */
internal fun deleteSharedRow(
    book: SharedBook,
    writer: String,
    kind: SharedRow,
    id: Uuid,
): Boolean =
    when (kind) {
        SharedRow.TRANCHE ->
            VestigeTranche.deleteWhere {
                (VestigeTranche.id eq id) and (VestigeTranche.userId eq book.owner) and
                    (VestigeTranche.recordedByUserId eq writer)
            }
        SharedRow.DEBT ->
            SettlementDebt.deleteWhere {
                (SettlementDebt.id eq id) and (SettlementDebt.userId eq book.owner) and
                    (SettlementDebt.recordedByUserId eq writer)
            }
        SharedRow.PAYMENT ->
            VestigePayment.deleteWhere {
                (VestigePayment.id eq id) and (VestigePayment.userId eq book.owner) and
                    (VestigePayment.recordedByUserId eq writer)
            }
        SharedRow.DISPOSAL ->
            VestigeProceedsDisposal.deleteWhere {
                (VestigeProceedsDisposal.id eq id) and (VestigeProceedsDisposal.userId eq book.owner) and
                    (VestigeProceedsDisposal.recordedByUserId eq writer)
            }
    } > 0

/** The kinds of row a member writes into a shared book. */
internal enum class SharedRow { TRANCHE, DEBT, PAYMENT, DISPOSAL }
