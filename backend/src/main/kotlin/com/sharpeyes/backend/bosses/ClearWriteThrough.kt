package com.sharpeyes.backend.bosses

import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.events.Topic
import com.sharpeyes.backend.events.publishToParty
import com.sharpeyes.backend.parties.linkedSeatsOn
import com.sharpeyes.backend.parties.runsInPeriod
import com.sharpeyes.backend.tokens.CaptureCounts
import com.sharpeyes.backend.tokens.syncPiecesForClear
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.time.Instant
import kotlin.uuid.Uuid

// A party clear is everybody's: in the game, the party dying to a boss clears it for each
// character in it. So a party owner's clear is copied onto the linked characters on that period's
// roster (V87), and their accounts read it as their own.
//
// Two rules keep it from guessing or looping. A copy never overwrites a character's OWN record (a
// tick, a capture, a drop), with one exception: a "not cleared" older than the owner's clear, which
// is what a planner captured before the run says. And only own records are copied on, so a copy
// never spreads further. Inside a transaction, like the rest.

/**
 * Everything that follows a clear changing, or what one is read against (the roster, the mode).
 * Every writer of boss_clear ends here, not in syncPiecesForClear. See ClearChangedCallersTest.
 */
internal fun clearChanged(
    characterId: Uuid,
    bossCatalogId: Uuid,
    period: LocalDate,
    now: Instant,
    capture: CaptureCounts? = null,
) {
    syncPiecesForClear(characterId, bossCatalogId, period, now, capture)
    writeClearThrough(characterId, bossCatalogId, period, now)
}

private fun writeClearThrough(
    characterId: Uuid,
    bossCatalogId: Uuid,
    period: LocalDate,
    now: Instant,
) {
    val source = clearOf(characterId, bossCatalogId, period)?.takeIf { it.via == null }
    val parties =
        Party
            .selectAll()
            .where {
                (Party.characterId eq characterId) and (Party.bossCatalogId eq bossCatalogId) and
                    (Party.standing eq true) and (Party.solo eq false)
            }.map { it[Party.id] to it[Party.oneOff] }
    for ((partyId, oneOff) in parties) {
        val ran = if (runsInPeriod(partyId, oneOff, period)) linkedSeatsOn(partyId, period) else emptyList()
        val wanted = if (source?.cleared == true) ran.map { it.characterId }.toSet() else emptySet()
        val changed = copyTo(partyId, wanted, Where(bossCatalogId, period, source?.at), now)
        if (changed.isNotEmpty()) {
            changed.forEach { clearChanged(it, bossCatalogId, period, now) }
            publishToParty(partyId, Topic.CLEARS)
        }
    }
}

/** Which boss and period a copy is for, and when the owner's clear behind it was recorded. */
private data class Where(
    val bossCatalogId: Uuid,
    val period: LocalDate,
    val clearedAt: Instant?,
)

/** Brings [partyId]'s copies in line with [wanted], and returns the characters whose clear moved. */
private fun copyTo(
    partyId: Uuid,
    wanted: Set<Uuid>,
    where: Where,
    now: Instant,
): Set<Uuid> {
    val (bossCatalogId, period, clearedAt) = where
    val here = { c: Uuid ->
        (BossClear.bossCatalogId eq bossCatalogId) and (BossClear.periodStart eq period) and
            (BossClear.characterId eq c)
    }
    val copies =
        BossClear
            .selectAll()
            .where {
                (BossClear.viaPartyId eq partyId) and (BossClear.bossCatalogId eq bossCatalogId) and
                    (BossClear.periodStart eq period)
            }.map { it[BossClear.characterId] }
            .toSet()
    val gone = copies - wanted
    gone.forEach { c -> BossClear.deleteWhere { here(c) and (BossClear.viaPartyId eq partyId) } }
    // Over silence, or an own "not cleared" from before the run. Anything else is the character's own
    // answer, or a copy from another party saying the same thing.
    val added =
        (wanted - copies).filter { c ->
            val there = clearOf(c, bossCatalogId, period)
            there == null || (there.via == null && !there.cleared && clearedAt != null && there.at < clearedAt)
        }
    added.forEach { c ->
        BossClear.upsert(BossClear.characterId, BossClear.bossCatalogId, BossClear.periodStart) {
            it[characterId] = c
            it[BossClear.bossCatalogId] = bossCatalogId
            it[periodStart] = period
            it[cleared] = true
            it[capturedAt] = now
            it[sourceScreenshotId] = null
            it[viaPartyId] = partyId
        }
    }
    return gone + added
}

private data class Clear(
    val cleared: Boolean,
    val via: Uuid?,
    val at: Instant,
)

private fun clearOf(
    characterId: Uuid,
    bossCatalogId: Uuid,
    period: LocalDate,
): Clear? =
    BossClear
        .selectAll()
        .where {
            (BossClear.characterId eq characterId) and (BossClear.bossCatalogId eq bossCatalogId) and
                (BossClear.periodStart eq period)
        }.firstOrNull()
        ?.let { Clear(it[BossClear.cleared], it[BossClear.viaPartyId], it[BossClear.capturedAt]) }
