package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.SettlementFigure
import com.sharpeyes.backend.db.SettlementListing
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notify
import com.sharpeyes.backend.notifications.resolve
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.neq
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The figures browsers report for each card, which is what keeps a listing honest. See
// SettlementListings.kt. Inside the caller's transaction.

private val PAYERS = setOf(PAYER_OWNER, PAYER_MEMBER)

@Serializable
data class ReportedFigure(
    val personId: String,
    val payer: String,
    /** Mesos the payer holds for the other side, as the reporter's screen works it out. */
    val amount: Long,
)

/**
 * What [userId]'s screen says each card's payer holds. A listing for any other amount is deleted.
 *
 * The payer's own figure is also kept, and a change in it tells the payee their split moved. Only
 * the payer's: the payee reporting a change is the payee already looking at it.
 */
internal fun reportFigures(
    userId: String,
    figures: List<ReportedFigure>,
    now: Instant,
) {
    figures.filter { it.payer in PAYERS && it.amount >= 0 }.forEach { figure ->
        val card = Uuid.parseOrNull(figure.personId)?.let { listingCardFor(it, userId) } ?: return@forEach
        dropListings(card, figure.payer, SettlementListing.amount neq figure.amount)
        if (card.side == figure.payer) recordFigure(card, figure.amount, now)
    }
}

/** What the payer's screen last said they hold on this card, if it has said. */
internal fun figureOf(
    personId: Uuid,
    payer: String,
): Long? =
    SettlementFigure
        .selectAll()
        .where { (SettlementFigure.personId eq personId) and (SettlementFigure.payer eq payer) }
        .firstOrNull()
        ?.get(SettlementFigure.amount)

private fun recordFigure(
    card: ListingCard,
    amount: Long,
    now: Instant,
) {
    val existing =
        SettlementFigure
            .selectAll()
            .where { (SettlementFigure.personId eq card.personId) and (SettlementFigure.payer eq card.side) }
            .firstOrNull()
    if (existing?.get(SettlementFigure.amount) == amount) return
    val id = existing?.get(SettlementFigure.id) ?: Uuid.random()
    if (existing == null) {
        SettlementFigure.insert {
            it[SettlementFigure.id] = id
            it[personId] = card.personId
            it[payer] = card.side
            it[SettlementFigure.amount] = amount
            it[updatedAt] = now
        }
    } else {
        SettlementFigure.update({ SettlementFigure.id eq id }) {
            it[SettlementFigure.amount] = amount
            it[updatedAt] = now
        }
    }
    // One entry per card on the payee's bell, saying the latest figure. Settled says nothing.
    resolve(NotificationKind.SPLIT_UPDATED, listOf(id))
    if (amount > 0) {
        notify(
            card.userOn(card.otherSide),
            NotificationKind.SPLIT_UPDATED,
            now,
            subjectId = id,
            actorId = card.userOn(card.side),
            payload = facts(card, amount),
        )
    }
}
