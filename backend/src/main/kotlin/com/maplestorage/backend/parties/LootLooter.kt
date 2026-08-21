package com.maplestorage.backend.parties

import com.maplestorage.backend.bosses.weekOf
import com.maplestorage.backend.db.PartyLoot
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.uuid.Uuid

// Who picked a drop up: the check, and the write. In its own file for the reason LootBundles.kt is,
// LootWrites.kt being at detekt's function ceiling.
//
// Until V64 the holder of an indivisible drop was recorded nowhere until it SOLD, since
// seller_member_id arrives with the sale. A member who does not loot is waiting on that sale, so
// their Drop Log listed rows with a stage and no holder. See V64__loot_looter.sql.

/**
 * Why a named looter cannot be recorded, or null when it can, naming none included.
 *
 * The same roster the seller is checked against: the seats that ran the week the drop FELL in, not
 * the party as it stands. Naming somebody who was not there would put a holder on the row who could
 * not have been holding it, which is the Drop Log answering "who do I ask" with a wrong name.
 *
 * Checked BEFORE the insert, unlike an arrangement: one seat against one roster, both readable
 * without the row existing, so it needs none of addedBundles' rollback.
 */
internal fun looterRefusal(
    partyId: Uuid,
    droppedOn: LocalDate,
    looterMemberId: String?,
): String? {
    val seat = looterMemberId?.let(Uuid::parseOrNull)
    return when {
        looterMemberId == null -> null
        seat == null -> "malformed looterMemberId"
        seat in rostersFor(listOf(partyId), weekOf(droppedOn))[partyId].orEmpty() -> null
        else -> "looterMemberId must be a seat that ran that week"
    }
}

/**
 * The same, for a drop whose pool is being worked out rather than named.
 *
 * A refusal here is a returned string, and a string does not roll a transaction back, so this has
 * to answer before poolFor can open a config: checking after it would leave a solo party behind on
 * every refusal. A boss with no pool yet is about to get a solo one, whose single seat is this
 * character, so there is nobody to name and naming one is refused rather than quietly dropped.
 */
internal fun looterRefusalForPool(
    existingPartyId: Uuid?,
    droppedOn: LocalDate,
    looterMemberId: String?,
): String? =
    when {
        existingPartyId != null -> looterRefusal(existingPartyId, droppedOn, looterMemberId)
        looterMemberId != null -> "a boss with no party has one seat, so it names no looter"
        else -> null
    }

/**
 * Records who picked a just-added drop up, or leaves it unanswered.
 *
 * Written beside addLoot rather than inside it, as addedBundles is: what fell and who bent down for
 * it are two facts, and one of them is refusable. Absent writes nothing, which is what an API caller
 * and a row filed from a clear both leave.
 *
 * The id is parsed rather than checked, because every caller has been through looterRefusal first
 * and a malformed one cannot reach here.
 */
internal fun recordLooter(
    lootId: Uuid,
    looterMemberId: String?,
) {
    if (looterMemberId == null) return
    PartyLoot.update({ PartyLoot.id eq lootId }) {
        it[PartyLoot.looterMemberId] = Uuid.parse(looterMemberId)
    }
}
