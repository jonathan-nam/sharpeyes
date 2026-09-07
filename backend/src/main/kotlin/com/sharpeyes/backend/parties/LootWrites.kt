package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyLootBundle
import com.sharpeyes.backend.db.PartyLootPayout
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The loot pool's writes, split from its reads the way PartyWrites.kt is split from PartyQueries.kt.
// Inside a transaction, like the rest. Nothing here computes money: see LootDtos.kt.

/**
 * Logs a drop, and marks its boss cleared where nothing has said otherwise.
 *
 * The clear is written here rather than by the route, so a drop cannot be logged without it: the
 * two are one fact, and a second way in that skipped it would leave a pool of drops beside a boss
 * reading "not reported". What it will and will not overwrite is clearFromDrop's.
 */
internal fun addLoot(
    partyId: Uuid,
    item: LootedDrop,
    bossCatalogId: Uuid?,
    droppedOn: LocalDate,
    now: Instant,
    source: LootSource = LootSource(),
): Uuid {
    val lootId = Uuid.random()
    // The mode the config runs TODAY, stamped on the row now so a later edit cannot re-attribute it.
    // Read here rather than passed in: every caller would otherwise have to look it up, and one that
    // forgot would file a drop the config could still rewrite. See V69__loot_difficulty.sql.
    val mode =
        Party
            .selectAll()
            .where { Party.id eq partyId }
            .firstOrNull()
            ?.get(Party.difficulty)
    PartyLoot.insert {
        it[id] = lootId
        it[PartyLoot.partyId] = partyId
        it[dropCatalogId] = item.dropCatalogId
        it[customName] = item.customName
        it[PartyLoot.bossCatalogId] = bossCatalogId
        it[quantity] = item.quantity
        it[PartyLoot.fromClear] = source.fromClear
        it[PartyLoot.solo] = source.solo
        it[PartyLoot.droppedOn] = droppedOn
        it[difficulty] = mode
        it[createdAt] = now
        it[updatedAt] = now
    }
    // Something fell here, so this config is one you run after all. Same reading as the clear
    // below: a drop is evidence of a night, and a retired config would hold it off Party View
    // while the wallet asked you to settle it.
    //
    // Only where the roster it comes back with is one the game allows. It was checked against the
    // boss's other configs when it was made, and nothing re-asked when a drop put it back, so a seat
    // that joined another config for this boss while it was retired came back double-booked: two
    // standing configs naming one character for a boss they can only clear once. See
    // validateBossRoster, which is the same rule this defers to.
    //
    // The DROP is recorded either way. It is a fact about a night that happened, and refusing it
    // over the config's arrangement would lose a real count to a bookkeeping rule. The pool simply
    // stays retired, which the Drop Log and the wallet both still read.
    if (revivesCleanly(partyId, now)) {
        Party.update({ (Party.id eq partyId) and (Party.standing eq false) }) { it[standing] = true }
    }
    // A drop with no boss names nothing to clear. The pickers always send one, so this is the
    // API-only case rather than an ordinary one.
    if (bossCatalogId != null) {
        // Both present by the FKs the insert above just satisfied: the party exists, and the boss
        // id came out of the catalog.
        val reset = bossResetOf(bossCatalogId)!!
        clearFromDrop(characterIdOfParty(partyId)!!, bossCatalogId, reset, droppedOn, now)
    }
    return lootId
}

/**
 * Which door wrote the row, which the drop itself cannot say.
 *
 * One value rather than two flags: both answer the same question, and both are read from the same
 * place at every call. See NewSeat, which is the same shape for the same reason.
 */
internal data class LootSource(
    // The app filed it from a clear, so un-ticking that clear may take it back. See V37.
    val fromClear: Boolean = false,
    // It fell on a run with nobody else, so it divides by one seat. See V72 and ranWith.
    val solo: Boolean = false,
)

/**
 * What fell: which drop it is, and how many.
 *
 * Exactly one of the two names it, which party_loot_named_once requires and the routes refuse
 * before it reaches here. The count is one unless the drop stacks.
 */
internal data class LootedDrop(
    val dropCatalogId: Uuid?,
    val customName: String? = null,
    val quantity: Int = 1,
)

/**
 * Records the sale, and pins who is owed for it.
 *
 * The payout roster is written once, on the first sale, and never re-derived: adding a member next
 * week must not create a debt on a drop they were not there for, and correcting a price must not
 * wipe out who has already been paid.
 *
 * Who is owed is the roster of the week the drop FELL in, not of the week it sells in and not of
 * the party today. A guest who ran that night is owed their share, and a usual member who sat that
 * week out is not, which is the whole point of a week having its own roster.
 *
 * Share counts are part of the figures, so a re-sale corrects them on the rows that already exist
 * rather than adding or dropping any. That keeps who has been paid while letting a mistyped double
 * share be fixed, and a seat left out of the request goes back to one rather than keeping the
 * count from the sale being corrected.
 */
internal fun sellLoot(
    lootId: Uuid,
    request: SellLootRequest,
    sellerMemberId: Uuid,
    partyId: Uuid,
    now: Instant,
) {
    val row =
        PartyLoot
            .selectAll()
            .where { PartyLoot.id eq lootId }
            .first()
    val droppedOn = row[PartyLoot.droppedOn]

    // Absent is one share, which is the even split every sale was before this could be said.
    val sharesFor = { seatId: Uuid -> request.shares[seatId.toString()] ?: 1 }

    PartyLoot.update({ PartyLoot.id eq lootId }) {
        it[soldAt] = now
        // One or the other, never both: see V76. A dollar sale's `amount` is not stored at all,
        // because a meso figure standing beside a dollar one is a conversion nobody entered.
        it[saleAmount] = if (request.usdCents != null) null else request.amount
        it[saleUsdCents] = request.usdCents
        it[amountBasis] = request.amountBasis
        it[splitMethod] = request.splitMethod
        it[PartyLoot.sellerMemberId] = sellerMemberId
        it[sellerShares] = sharesFor(sellerMemberId)
        it[updatedAt] = now
    }

    // A seat on no share is owed nothing, so it gets no row rather than a row of zero: a payout of
    // nothing keeps the drop reading as somebody still unpaid, forever. See V44.
    val existing =
        PartyLootPayout
            .selectAll()
            .where { PartyLootPayout.lootId eq lootId }
            .map { it[PartyLootPayout.memberId] }
            .toSet()

    // Against the roster rather than the rows already there, so re-selling a drop after a seat's
    // share moved off or onto zero writes the row that share now implies. Rows for somebody no
    // longer in the roster are left alone, because one may be the record that they were paid.
    ranWith(partyId, droppedOn, row[PartyLoot.solo])
        .filterNot { it == sellerMemberId }
        .forEach { seatId ->
            val count = sharesFor(seatId)
            when {
                count < 1 ->
                    PartyLootPayout.deleteWhere {
                        (PartyLootPayout.lootId eq lootId) and (PartyLootPayout.memberId eq seatId)
                    }
                seatId in existing ->
                    PartyLootPayout.update({
                        (PartyLootPayout.lootId eq lootId) and (PartyLootPayout.memberId eq seatId)
                    }) {
                        it[shares] = count
                    }
                else ->
                    PartyLootPayout.insert {
                        it[PartyLootPayout.lootId] = lootId
                        it[memberId] = seatId
                        it[paid] = false
                        it[shares] = count
                    }
            }
        }
}

/** Puts a drop back in the pool, dropping the payout record with it. Destructive on purpose. */
internal fun unsellLoot(
    lootId: Uuid,
    now: Instant,
) {
    PartyLootPayout.deleteWhere { PartyLootPayout.lootId eq lootId }
    PartyLoot.update({ PartyLoot.id eq lootId }) {
        it[soldAt] = null
        it[saleAmount] = null
        it[saleUsdCents] = null
        it[amountBasis] = null
        it[splitMethod] = null
        it[sellerMemberId] = null
        it[sellerShares] = null
        it[updatedAt] = now
    }
}

/**
 * Records who took the item, or clears it when [memberId] is null.
 *
 * The Heroic counterpart of sellLoot, and much smaller than it because nothing follows: no pot to
 * divide, no payout rows to pin, nobody owed. The item cannot move again, so the only fact worth
 * keeping is which seat has it.
 */
internal fun setLootTakenBy(
    lootId: Uuid,
    memberId: Uuid?,
    now: Instant,
) {
    PartyLoot.update({ PartyLoot.id eq lootId }) {
        it[takenByMemberId] = memberId
        it[updatedAt] = now
    }
}

/**
 * Records which seat picked up how many of a drop's stacks, replacing whatever was there.
 *
 * Delete then insert, rather than an upsert per seat: the arrangement is one fact about one night
 * and it has to be replaced whole. Upserting seat by seat would leave a stale row for somebody
 * dropped from the arrangement, and the sum would then be wrong in the one place the ledger trusts
 * it. An empty map is how "nobody has said" is written back.
 */
internal fun setLootBundles(
    lootId: Uuid,
    assignment: Map<Uuid, Int>,
) {
    PartyLootBundle.deleteWhere { PartyLootBundle.lootId eq lootId }
    for ((memberId, count) in assignment) {
        PartyLootBundle.insert {
            it[PartyLootBundle.lootId] = lootId
            it[PartyLootBundle.memberId] = memberId
            it[bundles] = count
        }
    }
}

/** Marks one member paid or unpaid. Returns false when they are not on this drop's roster. */
internal fun setPayoutPaid(
    lootId: Uuid,
    memberId: Uuid,
    paid: Boolean,
    now: Instant,
): Boolean {
    val changed =
        PartyLootPayout.update({
            (PartyLootPayout.lootId eq lootId) and (PartyLootPayout.memberId eq memberId)
        }) {
            it[PartyLootPayout.paid] = paid
            it[paidAt] = if (paid) now else null
        }
    return changed > 0
}

/**
 * Marks every named payout paid, across parties, or writes nothing at all.
 *
 * False without writing when any ref names a row this account cannot reach: a drop in someone
 * else's party, a member who is not on that drop's roster, or a drop deleted since the wallet was
 * drawn. Refusing the lot beats settling the reachable ones, which would leave the wallet showing
 * a smaller debt with nothing saying which part of the transfer it thinks happened.
 *
 * Rows already paid are left as they are rather than refused, so a settle sent twice is a no-op
 * instead of rewriting when the money moved.
 */
internal fun settlePayouts(
    userId: String,
    refs: List<Pair<Uuid, Uuid>>,
    now: Instant,
): Boolean {
    val wanted = refs.toSet()
    val reachable =
        PartyLootPayout
            .join(PartyLoot, JoinType.INNER, PartyLootPayout.lootId, PartyLoot.id)
            .join(Party, JoinType.INNER, PartyLoot.partyId, Party.id)
            .selectAll()
            .where { (PartyLootPayout.lootId inList wanted.map { it.first }) and (Party.userId eq userId) }
            .map { it[PartyLootPayout.lootId] to it[PartyLootPayout.memberId] }
            .toSet()
    if (!reachable.containsAll(wanted)) return false

    wanted.forEach { (lootId, memberId) ->
        PartyLootPayout.update({
            (PartyLootPayout.lootId eq lootId) and
                (PartyLootPayout.memberId eq memberId) and
                (PartyLootPayout.paid eq false)
        }) {
            it[PartyLootPayout.paid] = true
            it[paidAt] = now
        }
    }
    return true
}

/** One row of a lot with its ids parsed, so the checks and the writes read the same values. */
internal data class LotRow(
    val partyId: Uuid,
    val lootId: Uuid,
    val amount: Long,
    val sellerMemberId: Uuid,
    val shares: Map<String, Int>,
)

/**
 * Prices every row of a lot, or none of them, and answers with why not.
 *
 * The rules are sellLoot's, checked here rather than by the route because they are per row and the
 * route has one answer to give. Three are this shape's own: the drop has to be one the catalog marks
 * fungible, no row may already be sold, and every row has to be the same drop.
 *
 * Already sold is a refusal rather than an update, unlike the single-row sale, which is deliberately
 * re-sendable so a mistyped price can be fixed. A lot names rows a queue proposed, and a row that
 * sold since the queue was drawn is evidence the queue is stale: re-pricing it would silently
 * overwrite a sale somebody entered by hand.
 */
internal fun sellLot(
    userId: String,
    dropKey: String,
    amountBasis: String,
    splitMethod: String,
    rows: List<LotRow>,
    now: Instant,
): String? {
    // Every row read and checked before any is written. Exposed would roll back a throw, but a
    // refusal is not a throw, and returning early from a half-written loop would commit the prefix.
    val refusal = lotDropRefusal(dropKey) ?: rows.firstNotNullOfOrNull { lotRowRefusal(userId, dropKey, it) }
    if (refusal != null) return refusal

    rows.forEach { row ->
        sellLoot(
            row.lootId,
            SellLootRequest(
                amount = row.amount,
                amountBasis = amountBasis,
                splitMethod = splitMethod,
                sellerMemberId = row.sellerMemberId.toString(),
                shares = row.shares,
            ),
            row.sellerMemberId,
            row.partyId,
            now,
        )
    }
    return null
}

/**
 * Why this one row cannot take its slice of a lot, or null.
 *
 * sellLoot's own rules, plus two the shape needs. Every row has to be the drop the lot is of, and
 * none may already be sold: a lot names rows a queue proposed, so a row that sold since the queue was
 * drawn is evidence the queue is stale, and re-pricing it would overwrite a sale entered by hand.
 * The single-row sale is deliberately re-sendable, which is the opposite rule for the opposite reason.
 */
private fun lotRowRefusal(
    userId: String,
    dropKey: String,
    row: LotRow,
): String? {
    val loot = if (ownsParty(row.partyId, userId)) findLoot(row.lootId, row.partyId) else null
    return when {
        loot == null -> "a drop named here is not in your parties any more"
        !partyCanSell(row.partyId) -> "Heroic worlds do not trade, so this cannot be sold."
        loot.dropKey != dropKey -> "every row of a lot has to be the same drop"
        loot.soldAt != null -> "a drop named here has sold since this list was drawn, so reload it"
        row.amount < 0 -> "amount must be zero or more"
        row.sellerMemberId.toString() !in loot.ranThatWeek ->
            "sellerMemberId must be somebody who ran this boss that week"
        else -> sharesRefusal(row.shares, loot.ranThatWeek)
    }
}

internal fun deleteLoot(
    lootId: Uuid,
    partyId: Uuid,
): Boolean = PartyLoot.deleteWhere { (PartyLoot.id eq lootId) and (PartyLoot.partyId eq partyId) } > 0
