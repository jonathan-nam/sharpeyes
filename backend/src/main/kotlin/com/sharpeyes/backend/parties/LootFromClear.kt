package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.periodAfter
import com.sharpeyes.backend.bosses.periodOf
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.BossDropAmount
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.DropCatalog
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.db.PartyLootBundle
import com.sharpeyes.backend.db.VestigeSettlementLoot
import com.sharpeyes.backend.tokens.syncPiecesForClear
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.greaterEq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.core.less
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The drops a clear implies on a boss run ALONE, and taking them back when the clear goes away.
//
// The inverse of clearFromDrop, which has read the pair the other way round since V18: something
// fell, so the boss died. This is the other end. Some drops are GUARANTEED and their amount is in
// the catalog, so clearing Extreme Kalos alone already says 180 vestige coupons landed and typing
// that in is busywork. See V37__loot_from_clear.sql.
//
// SOLO ONLY. A party's coupons are typed, with the count filled in from the config (see
// defaultQuantity in the frontend). What fell is only half of what a party needs to know: the stacks
// have to be handed out, and a row that appeared on its own is one nobody remembers agreeing to, so
// a tick corrected the next day moved money. One seat has nothing to hand out and nobody to answer
// to, which is what makes the same row a fact there rather than a guess.
//
// Only drops the catalog has an amount for. That is what makes this a fact rather than a guess: a
// drop with no amount for this boss and difficulty may or may not have fallen, and the pool would be
// claiming something nobody saw.
//
// Inside a transaction, like the rest.

/**
 * Files what this clear guarantees on a solo pool, if anything.
 *
 * Silent about everything it cannot be sure of, and each of these is a reason a pool sees nothing
 * appear rather than a wrong row:
 *
 *  - no config for the pair, so there is no pool to file into
 *  - a PARTY config, whose drops are entered by the person who was there
 *  - a RETIRED config, whose pool is history rather than a boss still being run
 *  - no difficulty recorded, so which amount applies is unknown
 *  - no amount for that boss and difficulty, which is most of them
 *  - a row already there for this period, so re-ticking a clear does not stack up three of them
 */
internal fun lootFromClear(
    characterId: Uuid,
    bossCatalogId: Uuid,
    reset: String,
    on: LocalDate,
    now: Instant,
) {
    // One expression rather than a chain of early returns: each of these is the same answer, that
    // there is nothing this clear can be sure of.
    val partyId = partyIdFor(characterId, bossCatalogId)
    val config =
        partyId?.let {
            Party
                .selectAll()
                .where { Party.id eq it }
                .firstOrNull()
        }
    val difficulty = config?.get(Party.difficulty)
    // A pool this may file into at all: one seat, and still being run.
    //
    // One seat, because a party's stacks have to be handed out by whoever was there. Still being run,
    // because deleting a config that has drops retires it and keeps the pool (see
    // retireOrDeleteParty): history is not a boss still being run, and filing into one put 120 coupons
    // in a deleted pool nine days after it went, with nothing to say where they came from.
    val fileable = config != null && config[Party.solo] && config[Party.standing]
    if (partyId == null || difficulty == null || !fileable) return

    // The world the character is in, which the guaranteed count is keyed on as well as the mode.
    // Absent is a character that has gone, which files nothing rather than guessing a world. Looked
    // up after the guard above, so a clear that could never file anything asks nothing of the table.
    val world =
        Characters
            .selectAll()
            .where { Characters.id eq characterId }
            .firstOrNull()
            ?.get(Characters.worldType) ?: return

    val period = periodOf(reset, on)
    val nextPeriod = periodAfter(reset, period)
    // Dated inside the period the CLEAR is for, so a clear ticked for a past week files in that week
    // rather than this one. Today when the period is the one today falls in, which is the ordinary
    // case and the date a human would have typed.
    val droppedOn = if (on >= period && on < nextPeriod) on else period
    // WHAT FELL, always, never a share of it. One seat makes those the same number here, and the row
    // has to keep reading as what fell if the pool is ever adopted into a party. See V40.
    guaranteedDrops(bossCatalogId, difficulty, world)
        .filter { (dropId, pieces) -> pieces >= 1 && !alreadyFiled(partyId, dropId, period, nextPeriod) }
        .forEach { (dropId, pieces) ->
            addLoot(
                partyId,
                LootedDrop(dropId, quantity = pieces),
                bossCatalogId,
                droppedOn,
                now,
                LootSource(fromClear = true),
            )
        }
}

/** True when this period already has a row for this drop, so re-ticking cannot stack up a second. */
private fun alreadyFiled(
    partyId: Uuid,
    dropId: Uuid,
    period: LocalDate,
    nextPeriod: LocalDate,
): Boolean =
    PartyLoot
        .selectAll()
        .where {
            (PartyLoot.partyId eq partyId) and
                (PartyLoot.dropCatalogId eq dropId) and
                (PartyLoot.droppedOn greaterEq period) and
                (PartyLoot.droppedOn less nextPeriod)
        }.empty()
        .not()

/**
 * Takes back what a clear put there, and nothing else.
 *
 * Only rows the app added itself (from_clear), and only while they are untouched: a row that has
 * been sold is money somebody is owed, and un-ticking a clear is not a statement about that. A row a
 * human logged is left alone whatever the clear says, because they saw it fall.
 *
 * Not gated on the pool being solo, unlike lootFromClear. A pool adopted into a party still holds
 * the rows it filed while it was one seat, and the tick that put them there is what may take them.
 *
 * A retired config is NOT skipped either: rows filed into one before that rule existed still have to
 * be removable by the tick that put them there.
 */
internal fun unlootFromClear(
    characterId: Uuid,
    bossCatalogId: Uuid,
    reset: String,
    on: LocalDate,
) {
    val partyId = partyIdFor(characterId, bossCatalogId) ?: return
    val period = periodOf(reset, on)
    val nextPeriod = periodAfter(reset, period)
    val filed =
        PartyLoot
            .selectAll()
            .where {
                (PartyLoot.partyId eq partyId) and
                    (PartyLoot.fromClear eq true) and
                    (PartyLoot.soldAt eq null) and
                    (PartyLoot.droppedOn greaterEq period) and
                    (PartyLoot.droppedOn less nextPeriod)
            }.map { it[PartyLoot.id] }
    val spoken = spokenFor(filed)
    val loose = filed.filterNot { it in spoken }
    if (loose.isEmpty()) return
    PartyLoot.deleteWhere { PartyLoot.id inList loose }
}

/**
 * The rows something else has already said something about.
 *
 * `sold_at` alone is not enough to call a row untouched. A drop that comes in pieces never gets one:
 * it settles through the tranche ledger, so its sold_at stays null for ever (see LootPoolWork.kt),
 * and coupons are the only thing a clear files. Without this, closing a holder's books and then
 * correcting the mode you ran would take the closure with the row, silently.
 *
 * Two claims, both a human's: the books closed over this drop, and which seat picked up which stack.
 */
private fun spokenFor(lootIds: List<Uuid>): Set<Uuid> {
    if (lootIds.isEmpty()) return emptySet()
    val settled =
        VestigeSettlementLoot
            .selectAll()
            .where { VestigeSettlementLoot.lootId inList lootIds }
            .map { it[VestigeSettlementLoot.lootId] }
    val bundled =
        PartyLootBundle
            .selectAll()
            .where { PartyLootBundle.lootId inList lootIds }
            .map { it[PartyLootBundle.lootId] }
    return (settled + bundled).toSet()
}

/**
 * What this boss drops for certain at this difficulty IN THIS WORLD, as (drop id -> pieces).
 *
 * The world is not optional. How many drop is a per-world number, so without it every drop matches
 * twice and the clear files each of them once per world: a boss with one guaranteed drop filed two
 * rows, and one with four filed eight.
 */
private fun guaranteedDrops(
    bossCatalogId: Uuid,
    difficulty: String,
    world: String,
): List<Pair<Uuid, Int>> =
    BossDropAmount
        .innerJoin(DropCatalog)
        .selectAll()
        .where {
            (BossDropAmount.bossCatalogId eq bossCatalogId) and
                (BossDropAmount.difficulty eq difficulty) and
                (BossDropAmount.world eq world)
        }.map { it[BossDropAmount.dropCatalogId] to it[BossDropAmount.pieces] }

/**
 * Takes back the clear this config's boss is ticked for in the period it is in now.
 *
 * A tick made through a party row is that party saying it ran the boss, so taking the config off
 * Party View takes the statement with it, along with the coupons the tick filed on its own (see
 * unlootFromClear). Without this, deleting a config and adding it again handed back a boss already
 * ticked and a pool already holding its guaranteed drop, neither of which anybody had entered.
 *
 * The ROW is deleted rather than set false. False is somebody saying the boss is NOT done, which is
 * a claim of its own that the clear matrix draws; nobody is making it. Nobody has said anything.
 *
 * A hand tick only. A clear with a screenshot behind it is what a capture read off the planner, and
 * deleting a config does not unmake a capture or make its evidence wrong.
 *
 * This period only. Earlier ones are history, which the matrix draws and a retired pool keeps, and a
 * boss killed in July was still killed in July.
 */
internal fun withdrawClear(
    partyId: Uuid,
    now: Instant,
) {
    val config = Party.selectAll().where { Party.id eq partyId }.firstOrNull()
    val bossId = config?.get(Party.bossCatalogId)
    val characterId = config?.get(Party.characterId)
    val reset = bossId?.let(::bossResetOf)
    if (bossId == null || characterId == null || reset == null) return
    val period = periodStartFor(reset, now)
    val ticked =
        BossClear
            .selectAll()
            .where {
                (BossClear.characterId eq characterId) and
                    (BossClear.bossCatalogId eq bossId) and
                    (BossClear.periodStart eq period)
            }.firstOrNull()
    if (ticked == null || ticked[BossClear.sourceScreenshotId] != null) return

    // Before the row goes, while there is still a clear for it to be the inverse of. Only ever takes
    // rows the app filed and nobody has spoken for, which is unlootFromClear's own rule.
    unlootFromClear(characterId, bossId, reset, todayIn(now))
    BossClear.deleteWhere {
        (BossClear.characterId eq characterId) and
            (BossClear.bossCatalogId eq bossId) and
            (BossClear.periodStart eq period)
    }
    syncPiecesForClear(characterId, bossId, period, now)
}
