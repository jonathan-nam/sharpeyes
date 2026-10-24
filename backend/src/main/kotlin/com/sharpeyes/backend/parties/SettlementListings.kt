package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.db.SettlementListing
import com.sharpeyes.backend.events.EventTarget
import com.sharpeyes.backend.events.Topic
import com.sharpeyes.backend.events.publish
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notify
import com.sharpeyes.backend.notifications.resolve
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.Op
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.or
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// Auction house listings a payee posts on a Settlement card, so the payer can pay into them. See V101.
//
// A listing is only good for the figure it was posted for. The backend cannot work that figure out
// (lib/settlement.ts does), so both sides' browsers report it as they draw the card, and a listing
// for any other amount is deleted on the spot. Inside the caller's transaction throughout.

internal const val PAYER_OWNER = "OWNER"
internal const val PAYER_MEMBER = "MEMBER"

/** A card between two linked accounts, as the caller stands on it. */
internal data class ListingCard(
    val personId: Uuid,
    val owner: String,
    val member: String,
    /** PAYER_OWNER or PAYER_MEMBER: which side the caller is. */
    val side: String,
) {
    fun userOn(side: String) = if (side == PAYER_OWNER) owner else member

    val otherSide get() = if (side == PAYER_OWNER) PAYER_MEMBER else PAYER_OWNER
}

/** The card at [personId] if [userId] is either side of it and the other side signs in. */
internal fun listingCardFor(
    personId: Uuid,
    userId: String,
): ListingCard? {
    val row = Person.selectAll().where { Person.id eq personId }.firstOrNull()
    val owner = row?.get(Person.userId)
    val member = row?.get(Person.linkedUserId)?.takeIf { it != owner }
    val side =
        when (userId) {
            owner -> PAYER_OWNER
            member -> PAYER_MEMBER
            else -> null
        }
    return if (owner != null && member != null && side != null) ListingCard(personId, owner, member, side) else null
}

@Serializable
data class SettlementListingView(
    val id: String,
    val personId: String,
    /** OWNER or MEMBER: the side holding the money, who the listing is for. */
    val payer: String,
    val amount: Long,
    val postedByYou: Boolean,
    val createdAt: String,
)

/** Every listing on a card [userId] is either side of. No image: that is its own request. */
internal fun listingsFor(userId: String): List<SettlementListingView> =
    SettlementListing
        .join(Person, JoinType.INNER, SettlementListing.personId, Person.id)
        .select(
            SettlementListing.id,
            SettlementListing.personId,
            SettlementListing.payer,
            SettlementListing.amount,
            SettlementListing.postedBy,
            SettlementListing.createdAt,
        ).where { (Person.userId eq userId) or (Person.linkedUserId eq userId) }
        .orderBy(SettlementListing.createdAt, SortOrder.ASC)
        .map {
            SettlementListingView(
                id = it[SettlementListing.id].toString(),
                personId = it[SettlementListing.personId].toString(),
                payer = it[SettlementListing.payer],
                amount = it[SettlementListing.amount],
                postedByYou = it[SettlementListing.postedBy] == userId,
                createdAt = it[SettlementListing.createdAt].toString(),
            )
        }

/** The image of listing [id], if [userId] is either side of its card. */
internal fun listingImage(
    id: Uuid,
    userId: String,
): Pair<String, ByteArray>? =
    SettlementListing
        .selectAll()
        .where { SettlementListing.id eq id }
        .firstOrNull()
        ?.takeIf { listingCardFor(it[SettlementListing.personId], userId) != null }
        ?.let { it[SettlementListing.contentType] to it[SettlementListing.image] }

internal sealed interface PostOutcome {
    data object Posted : PostOutcome

    data object NothingOwed : PostOutcome

    /** The payer's screen says a different figure. */
    data object Stale : PostOutcome
}

/**
 * Posts [image] as the caller's listing for [amount], replacing any they had on this card.
 *
 * The caller is the payee, so the listing is for the other side. Refused when the payer's own screen
 * last said a different figure: it would be deleted the moment they drew the card.
 */
internal fun postListing(
    card: ListingCard,
    amount: Long,
    contentType: String,
    image: ByteArray,
    now: Instant,
): PostOutcome =
    when {
        amount <= 0 -> PostOutcome.NothingOwed
        figureOf(card.personId, card.otherSide)?.let { it != amount } == true -> PostOutcome.Stale
        else -> {
            writeListing(card, amount, contentType, image, now)
            PostOutcome.Posted
        }
    }

private fun writeListing(
    card: ListingCard,
    amount: Long,
    contentType: String,
    image: ByteArray,
    now: Instant,
) {
    val payer = card.otherSide
    dropListings(card, payer, Op.TRUE)
    val id = Uuid.random()
    SettlementListing.insert {
        it[SettlementListing.id] = id
        it[personId] = card.personId
        it[SettlementListing.payer] = payer
        it[SettlementListing.amount] = amount
        it[postedBy] = card.userOn(card.side)
        it[SettlementListing.contentType] = contentType
        it[SettlementListing.image] = image
        it[createdAt] = now
    }
    notify(
        card.userOn(payer),
        NotificationKind.LISTING_POSTED,
        now,
        subjectId = id,
        actorId = card.userOn(card.side),
        payload = facts(card, amount),
    )
    tellBoth(card)
}

/** Takes back a listing [userId] posted. False when there is no such listing of theirs. */
internal fun removeListing(
    id: Uuid,
    userId: String,
): Boolean {
    val row =
        SettlementListing
            .selectAll()
            .where { (SettlementListing.id eq id) and (SettlementListing.postedBy eq userId) }
            .firstOrNull()
    val card = row?.let { listingCardFor(it[SettlementListing.personId], userId) }
    if (row != null && card != null) dropListings(card, row[SettlementListing.payer], SettlementListing.id eq id)
    return card != null
}

/** Deletes [card]'s listings for [payer] matching [which], with their bell entries. */
internal fun dropListings(
    card: ListingCard,
    payer: String,
    which: Op<Boolean>,
) {
    val scope = (SettlementListing.personId eq card.personId) and (SettlementListing.payer eq payer) and which
    val ids = SettlementListing.select(SettlementListing.id).where { scope }.map { it[SettlementListing.id] }
    if (ids.isEmpty()) return
    resolve(NotificationKind.LISTING_POSTED, ids)
    SettlementListing.deleteWhere { SettlementListing.id inList ids }
    tellBoth(card)
}

internal fun facts(
    card: ListingCard,
    amount: Long,
) = buildJsonObject {
    put("personId", card.personId.toString())
    put("amount", amount)
}

private fun tellBoth(card: ListingCard) =
    publish(
        listOf(card.owner, card.member),
        Topic.SETTLEMENT,
        EventTarget(person = card.personId.toString()),
    )
