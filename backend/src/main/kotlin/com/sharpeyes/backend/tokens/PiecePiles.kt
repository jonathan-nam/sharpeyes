package com.sharpeyes.backend.tokens

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyPiecePile
import com.sharpeyes.backend.db.PartyPieceTake
import com.sharpeyes.backend.db.TokenClearAmount
import com.sharpeyes.backend.parties.bossResetOf
import com.sharpeyes.backend.parties.clearFromDrop
import com.sharpeyes.backend.parties.rosterFor
import com.sharpeyes.backend.parties.runsInPeriod
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// A party's pooled pile of Eternal pieces, one per week: Kalos, Kaling, First Adversary and Malefic
// Star in Interactive, where the pile falls once for the whole party. See V79__piece_sync.sql.
//
// Added by hand on Party View, the way a party's coupons are: the clear does not file it, because
// what fell and who looted it are the party's to say. Once added it is a record of that week, so a
// later change to the config's mode or ratio does not rewrite it.
//
// Kept out of party_loot, so it never reaches the Drop Log, a sale or a settlement.

private data class FiledPile(
    val tokenId: Uuid,
    val difficulty: String,
    val stackSize: Int,
)

private fun pileRow(
    partyId: Uuid,
    period: LocalDate,
): ResultRow? =
    PartyPiecePile
        .selectAll()
        .where { (PartyPiecePile.partyId eq partyId) and (PartyPiecePile.periodStart eq period) }
        .firstOrNull()

/** Your own characters seated in this pile, whose inventories it decides. */
internal fun seatedCharacters(
    partyId: Uuid,
    period: LocalDate,
): Set<Uuid> =
    PartyPieceTake
        .join(PartyMember, JoinType.INNER, PartyPieceTake.memberId, PartyMember.id)
        .selectAll()
        .where { (PartyPieceTake.partyId eq partyId) and (PartyPieceTake.periodStart eq period) }
        .mapNotNull { it[PartyMember.characterId] }
        .toSet()

/**
 * What this character took of a party pile for this boss and [period], or null when no pile seats
 * them. Their own config's pile first, then any other party of yours they sat in that week.
 */
internal fun pileTakeFor(
    characterId: Uuid,
    bossCatalogId: Uuid,
    period: LocalDate,
): Pair<Uuid, Int>? =
    PartyPieceTake
        .join(PartyMember, JoinType.INNER, PartyPieceTake.memberId, PartyMember.id)
        .join(Party, JoinType.INNER, PartyMember.partyId, Party.id)
        .join(PartyPiecePile, JoinType.INNER) {
            (PartyPiecePile.partyId eq PartyPieceTake.partyId) and
                (PartyPiecePile.periodStart eq PartyPieceTake.periodStart)
        }.selectAll()
        .where {
            (PartyMember.characterId eq characterId) and (Party.bossCatalogId eq bossCatalogId) and
                (PartyPieceTake.periodStart eq period)
        }.sortedByDescending { it[Party.characterId] == characterId }
        .firstOrNull()
        ?.let { it[PartyPiecePile.tokenCatalogId] to it[PartyPieceTake.quantity] }

/**
 * A standing party of another character's that seats this one in [period]'s roster, for this boss.
 * What an alt's clear is read against when the alt has no config of its own.
 */
internal fun seatedParty(
    characterId: Uuid,
    bossCatalogId: Uuid,
    period: LocalDate,
): ResultRow? =
    Party
        .join(PartyMember, JoinType.INNER, Party.id, PartyMember.partyId)
        .selectAll()
        .where {
            (PartyMember.characterId eq characterId) and (Party.bossCatalogId eq bossCatalogId) and
                (Party.standing eq true) and (Party.solo eq false)
        }.firstOrNull { row ->
            runsInPeriod(row[Party.id], row[Party.oneOff], period) &&
                row[PartyMember.id] in rosterFor(row[Party.id], period)
        }

/** A pile as Party View sends it: what fell, and what each seat took. */
internal data class PileEdit(
    val total: Int,
    val takes: Map<Uuid, Int>,
)

/**
 * Adds or corrects [period]'s pile, or refuses with a reason.
 *
 * A new pile is of the token the config's mode drops; an existing one keeps the token and mode it
 * was added at. Every take is whole stacks and they add up to the total. Adding one says the boss
 * died, as logging a drop does, so the config's own character is ticked cleared for that week.
 */
internal fun editPile(
    partyId: Uuid,
    period: LocalDate,
    edit: PileEdit,
    now: Instant,
): String? {
    val config = Party.selectAll().where { Party.id eq partyId }.first()
    val shape = if (config[Party.solo]) null else pileShape(config, pileRow(partyId, period))
    val seats =
        PartyMember
            .selectAll()
            .where { PartyMember.partyId eq partyId }
            .map { it[PartyMember.id] }
            .toSet()
    val stack = shape?.stackSize ?: 1
    val refusal =
        when {
            shape == null -> "this party has no pooled pieces to divide at its difficulty"
            edit.total !in 0..MAX_PILE -> "a pile is between 0 and $MAX_PILE pieces"
            edit.takes.keys.any { it !in seats } -> "a take may only name a seat in this party"
            edit.takes.values.any { it < 0 || it % stack != 0 } -> "every take is whole stacks of $stack"
            edit.takes.values.sum() != edit.total -> "the takes must add up to the pile"
            else -> null
        }
    if (shape != null && refusal == null) {
        removePile(partyId, period)
        writePile(partyId, period, shape, edit, now)
        clearFromDrop(
            config[Party.characterId],
            config[Party.bossCatalogId],
            bossResetOf(config[Party.bossCatalogId])!!,
            period,
            now,
        )
    }
    return refusal
}

/** Takes [period]'s pile off the party. The clear it implied stays, as it does for a drop. */
internal fun removePile(
    partyId: Uuid,
    period: LocalDate,
) {
    PartyPiecePile.deleteWhere { (PartyPiecePile.partyId eq partyId) and (PartyPiecePile.periodStart eq period) }
}

private fun writePile(
    partyId: Uuid,
    period: LocalDate,
    shape: FiledPile,
    edit: PileEdit,
    now: Instant,
) {
    PartyPiecePile.insert {
        it[PartyPiecePile.partyId] = partyId
        it[periodStart] = period
        it[tokenCatalogId] = shape.tokenId
        it[difficulty] = shape.difficulty
        it[total] = edit.total
        it[stackSize] = shape.stackSize
        it[filedAt] = now
    }
    edit.takes.forEach { (memberId, quantity) ->
        PartyPieceTake.insert {
            it[PartyPieceTake.partyId] = partyId
            it[periodStart] = period
            it[PartyPieceTake.memberId] = memberId
            it[PartyPieceTake.quantity] = quantity
        }
    }
}

/**
 * What a pile on this config is made of: the one already added, else the config's mode. Null when
 * that mode drops no POOLED pile in the character's world, which is every Heroic party.
 */
private fun pileShape(
    config: ResultRow,
    existing: ResultRow?,
): FiledPile? {
    if (existing != null) {
        return FiledPile(
            existing[PartyPiecePile.tokenCatalogId],
            existing[PartyPiecePile.difficulty],
            existing[PartyPiecePile.stackSize],
        )
    }
    val world =
        Characters
            .selectAll()
            .where { Characters.id eq config[Party.characterId] }
            .first()[Characters.worldType]
    val mode = config[Party.difficulty]
    return TokenClearAmount
        .selectAll()
        .where {
            (TokenClearAmount.bossCatalogId eq config[Party.bossCatalogId]) and
                (TokenClearAmount.difficulty eq (mode ?: "")) and (TokenClearAmount.world eq world)
        }.firstOrNull()
        ?.takeIf { it[TokenClearAmount.pooled] && it[TokenClearAmount.quantity] > 0 }
        ?.let { FiledPile(it[TokenClearAmount.tokenCatalogId], mode!!, it[TokenClearAmount.stackSize]) }
}

/** A typo guard, comfortably past the 18 that is the most any boss drops. */
private const val MAX_PILE = 999
