package com.sharpeyes.backend.tokens

import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyPiecePile
import com.sharpeyes.backend.db.PartyPieceTake
import com.sharpeyes.backend.db.TokenClearAmount
import com.sharpeyes.backend.parties.rosterFor
import com.sharpeyes.backend.parties.runsInPeriod
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// A party's pooled pile of Eternal pieces, one per week: Kalos, Kaling, First Adversary and Malefic
// Star in Interactive, where the pile falls once for the whole party. See V79__piece_sync.sql.
//
// The clear files it from the config: the mode decides the pile, the seats' piece ratio divides it
// in whole stacks among the seats that ran that week. Until somebody edits it, it follows the config
// and the roster. Once edited it is that week's record and nothing re-files it.
//
// Kept out of party_loot, so it never reaches the Drop Log, a sale or a settlement.

/**
 * [stacks] divided by [weights], in whole stacks, largest remainder first and ties to the earlier seat.
 *
 * All-zero weights divide evenly rather than handing nobody anything: validatePieceShares refuses
 * that ratio, so it can only be a roster that ran without anybody who takes pieces.
 */
internal fun splitStacks(
    stacks: Int,
    weights: List<Int>,
): List<Int> {
    if (weights.isEmpty()) return emptyList()
    val w = if (weights.sum() == 0) weights.map { 1 } else weights
    val sum = w.sum()
    val floors = w.map { it * stacks / sum }
    val left = stacks - floors.sum()
    val extra =
        w.indices
            .sortedWith(compareByDescending<Int> { w[it] * stacks % sum }.thenBy { it })
            .take(left)
            .toSet()
    return floors.mapIndexed { i, f -> if (i in extra) f + 1 else f }
}

private data class FiledPile(
    val tokenId: Uuid,
    val difficulty: String,
    val total: Int,
    val stackSize: Int,
    val takes: Map<Uuid, Int>,
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
        .join(PartyMember, org.jetbrains.exposed.v1.core.JoinType.INNER, PartyPieceTake.memberId, PartyMember.id)
        .selectAll()
        .where { (PartyPieceTake.partyId eq partyId) and (PartyPieceTake.periodStart eq period) }
        .mapNotNull { it[PartyMember.characterId] }
        .toSet()

/**
 * The pile this config would file for [period] as things stand, or null when it files none.
 *
 * None unless the config's own character is cleared, the config is a standing party running that
 * week with a mode named, the character is in Interactive, and that mode's pile is pooled and not
 * empty. Heroic and the instanced bosses hand everybody their own count and have no pile to divide.
 */
private fun defaultPile(
    config: ResultRow,
    period: LocalDate,
): FiledPile? {
    val partyId = config[Party.id]
    val characterId = config[Party.characterId]
    val bossId = config[Party.bossCatalogId]
    val difficulty = config[Party.difficulty]
    val world =
        Characters
            .selectAll()
            .where { Characters.id eq characterId }
            .firstOrNull()
            ?.get(Characters.worldType)
    val cleared =
        BossClear
            .selectAll()
            .where {
                (BossClear.characterId eq characterId) and (BossClear.bossCatalogId eq bossId) and
                    (BossClear.periodStart eq period)
            }.firstOrNull()
            ?.get(BossClear.cleared) == true
    val running = config[Party.standing] && !config[Party.solo] && runsInPeriod(partyId, config[Party.oneOff], period)
    // Only Interactive rows are pooled, so a Heroic character finds no pile to divide.
    val mode = difficulty.takeIf { cleared && running }
    val amount =
        if (mode == null || world == null) {
            null
        } else {
            TokenClearAmount
                .selectAll()
                .where {
                    (TokenClearAmount.bossCatalogId eq bossId) and (TokenClearAmount.difficulty eq mode) and
                        (TokenClearAmount.world eq world)
                }.firstOrNull()
                ?.takeIf { it[TokenClearAmount.pooled] && it[TokenClearAmount.quantity] > 0 }
        }
    val seats = rosterFor(partyId, period)
    if (amount == null || difficulty == null || seats.isEmpty()) return null

    val weights =
        PartyMember
            .selectAll()
            .where { PartyMember.id inList seats }
            .associate { it[PartyMember.id] to it[PartyMember.pieceShares] }
    val stackSize = amount[TokenClearAmount.stackSize]
    val total = amount[TokenClearAmount.quantity]
    val stacks = splitStacks(total / stackSize, seats.map { weights[it] ?: 1 })
    return FiledPile(
        tokenId = amount[TokenClearAmount.tokenCatalogId],
        difficulty = difficulty,
        total = total,
        stackSize = stackSize,
        takes = seats.zip(stacks.map { it * stackSize }).toMap(),
    )
}

/**
 * Files, re-files or takes back the pile on this character's party config for [period].
 *
 * An edited pile is left exactly as it is. Returns your characters seated in the pile before and
 * after, every one of whose inventories may have moved.
 */
internal fun refilePile(
    characterId: Uuid,
    bossCatalogId: Uuid,
    period: LocalDate,
    now: Instant,
): Set<Uuid> {
    val config =
        Party
            .selectAll()
            .where { (Party.characterId eq characterId) and (Party.bossCatalogId eq bossCatalogId) }
            .firstOrNull() ?: return emptySet()
    val partyId = config[Party.id]
    val before = seatedCharacters(partyId, period)
    if (pileRow(partyId, period)?.get(PartyPiecePile.edited) != true) {
        PartyPiecePile.deleteWhere { (PartyPiecePile.partyId eq partyId) and (PartyPiecePile.periodStart eq period) }
        defaultPile(config, period)?.let { writePile(partyId, period, it, edited = false, now) }
    }
    return before + seatedCharacters(partyId, period)
}

private fun writePile(
    partyId: Uuid,
    period: LocalDate,
    pile: FiledPile,
    edited: Boolean,
    now: Instant,
) {
    PartyPiecePile.insert {
        it[PartyPiecePile.partyId] = partyId
        it[periodStart] = period
        it[tokenCatalogId] = pile.tokenId
        it[difficulty] = pile.difficulty
        it[total] = pile.total
        it[stackSize] = pile.stackSize
        it[PartyPiecePile.edited] = edited
        it[filedAt] = now
    }
    pile.takes.forEach { (memberId, quantity) ->
        PartyPieceTake.insert {
            it[PartyPieceTake.partyId] = partyId
            it[periodStart] = period
            it[PartyPieceTake.memberId] = memberId
            it[PartyPieceTake.quantity] = quantity
        }
    }
}

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
        .join(PartyMember, org.jetbrains.exposed.v1.core.JoinType.INNER, PartyPieceTake.memberId, PartyMember.id)
        .join(Party, org.jetbrains.exposed.v1.core.JoinType.INNER, PartyMember.partyId, Party.id)
        .join(PartyPiecePile, org.jetbrains.exposed.v1.core.JoinType.INNER) {
            (PartyPiecePile.partyId eq PartyPieceTake.partyId) and
                (PartyPiecePile.periodStart eq PartyPieceTake.periodStart)
        }.selectAll()
        .where {
            (PartyMember.characterId eq characterId) and (Party.bossCatalogId eq bossCatalogId) and
                (PartyPieceTake.periodStart eq period)
        }.sortedByDescending { it[Party.characterId] == characterId }
        .firstOrNull()
        ?.let { it[PartyPiecePile.tokenCatalogId] to it[PartyPieceTake.quantity] }

/** A hand-corrected pile, as the Party View editor sends it. */
internal data class PileEdit(
    val total: Int,
    val takes: Map<Uuid, Int>,
)

/**
 * Writes a corrected pile for [period] and marks it edited, or refuses with a reason.
 *
 * The token and stack size come from the pile already filed, else from the config's mode, so a week
 * nobody ticked can still be recorded. Every take is whole stacks and they add up to the total.
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
        PartyPiecePile.deleteWhere { (PartyPiecePile.partyId eq partyId) and (PartyPiecePile.periodStart eq period) }
        writePile(partyId, period, shape.copy(total = edit.total, takes = edit.takes), edited = true, now)
    }
    return refusal
}

/**
 * What a pile on this config is made of: the one already filed, else the config's mode. Null when
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
            existing[PartyPiecePile.total],
            existing[PartyPiecePile.stackSize],
            emptyMap(),
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
        ?.takeIf { it[TokenClearAmount.pooled] }
        ?.let {
            FiledPile(it[TokenClearAmount.tokenCatalogId], mode!!, 0, it[TokenClearAmount.stackSize], emptyMap())
        }
}

/** Puts an edited pile back on what the config files, and returns who it seated before and after. */
internal fun resetPile(
    partyId: Uuid,
    period: LocalDate,
    now: Instant,
): Set<Uuid> {
    val config = Party.selectAll().where { Party.id eq partyId }.first()
    val before = seatedCharacters(partyId, period)
    PartyPiecePile.deleteWhere { (PartyPiecePile.partyId eq partyId) and (PartyPiecePile.periodStart eq period) }
    return before + refilePile(config[Party.characterId], config[Party.bossCatalogId], period, now)
}

/** A typo guard, comfortably past the 18 that is the most any boss drops. */
private const val MAX_PILE = 999
