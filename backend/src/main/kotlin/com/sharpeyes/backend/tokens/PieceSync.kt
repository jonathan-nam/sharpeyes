package com.sharpeyes.backend.tokens

import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.characters.writeTokenCount
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.BossClear
import com.sharpeyes.backend.db.CharacterTokenCount
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PieceClearCredit
import com.sharpeyes.backend.db.TokenClearAmount
import com.sharpeyes.backend.parties.runsInPeriod
import com.sharpeyes.backend.users.inActiveWorld
import kotlinx.datetime.LocalDate
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.select
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// A boss clear adding its Eternal pieces to the character's inventory, for an account that has
// turned it on. See V79__piece_sync.sql.
//
// The inventory count stays ABSOLUTE (see CharacterTokenWrites.kt): this adds to it, and records
// what it added in piece_clear_credit, so the same clear never adds twice and un-ticking takes back
// exactly that. A typed figure is assumed to carry the credit (it was typed over a count showing
// it), so the credit still comes off it. An inventory capture since is the game's own number, which
// a wrongly ticked clear never added to, so the credit is then left alone for good.
//
// Inside a transaction, like the rest.

/** Why a cleared boss's pieces were not added. Shown beside the setting. */
enum class PieceSyncGap {
    // No standing config names the mode this character runs the boss at.
    NO_DIFFICULTY,

    // A pooled drop in a party whose pieces nobody has added on Party View yet.
    PARTY_LOOT,

    // Ticked before the sync was on. Whether the count already includes it is unknown.
    BEFORE_SYNC,
}

/** The capture a clear arrived with. Its inventory read, if any, already includes the drop. */
internal data class CaptureCounts(
    val screenshotId: Uuid,
    val inventoryComplete: Boolean,
)

private sealed interface Owed {
    data object None : Owed

    data class Pieces(
        val tokenId: Uuid,
        val quantity: Int,
    ) : Owed

    data class Gap(
        val gap: PieceSyncGap,
    ) : Owed
}

/**
 * Brings the pieces this clear added in line with whether the boss is cleared, and at what mode.
 *
 * Call after anything that changes the clear for [period] or the mode of the config it is read at.
 * A changed mode takes the old pieces back and adds the new ones (Hard Kaling's 7 rings become
 * Normal's 5 fragments).
 */
internal fun syncPiecesForClear(
    characterId: Uuid,
    bossCatalogId: Uuid,
    period: LocalDate,
    now: Instant,
    capture: CaptureCounts? = null,
) {
    syncOne(characterId, bossCatalogId, period, now, capture)
}

/** Brings each of these characters' pieces in line with the pile that seats them. */
internal fun syncSeated(
    characterIds: Set<Uuid>,
    bossCatalogId: Uuid,
    period: LocalDate,
    now: Instant,
) = characterIds.forEach { syncOne(it, bossCatalogId, period, now, capture = null) }

private fun syncOne(
    characterId: Uuid,
    bossCatalogId: Uuid,
    period: LocalDate,
    now: Instant,
    capture: CaptureCounts?,
) {
    val userId =
        Characters
            .selectAll()
            .where { Characters.id eq characterId }
            .firstOrNull()
            ?.get(Characters.userId)
    if (userId == null || !syncEnabled(userId)) return

    // A party pile that seats this character is a record of what they took, like a logged drop, so it
    // counts whether or not their own clear is ticked. Everything else follows the clear.
    val seated = pileTakeFor(characterId, bossCatalogId, period)
    val owed =
        when {
            seated != null -> if (seated.second > 0) Owed.Pieces(seated.first, seated.second) else Owed.None
            isCleared(characterId, bossCatalogId, period) -> owedFor(characterId, bossCatalogId, period)
            else -> Owed.None
        }
    val credit =
        PieceClearCredit
            .selectAll()
            .where {
                (PieceClearCredit.characterId eq characterId) and
                    (PieceClearCredit.bossCatalogId eq bossCatalogId) and
                    (PieceClearCredit.periodStart eq period)
            }.firstOrNull()
    val unchanged =
        credit != null &&
            owed is Owed.Pieces &&
            owed.tokenId == credit[PieceClearCredit.tokenCatalogId] &&
            owed.quantity == credit[PieceClearCredit.quantity]
    // A credit that cannot be taken back stays, and nothing is added over it.
    val free = credit == null || (!unchanged && takeBack(credit, now))
    if (free && owed is Owed.Pieces) give(characterId, bossCatalogId, period, owed, now, capture)
}

private fun isCleared(
    characterId: Uuid,
    bossCatalogId: Uuid,
    period: LocalDate,
): Boolean =
    BossClear
        .selectAll()
        .where {
            (BossClear.characterId eq characterId) and
                (BossClear.bossCatalogId eq bossCatalogId) and
                (BossClear.periodStart eq period)
        }.firstOrNull()
        ?.get(BossClear.cleared) == true

/**
 * What one clear of this boss puts in this character's inventory, or why that is not known.
 *
 * The mode comes from the character's config for the boss, as a solo clear's coupons do (see
 * LootFromClear.kt), and only while that config is standing and runs in [period]. A planner
 * capture's difficulty badge is not used: it is set independently of what is actually cleared.
 */
private fun owedFor(
    characterId: Uuid,
    bossCatalogId: Uuid,
    period: LocalDate,
): Owed {
    // A party pile that seats this character says exactly what they took, whatever their own config.
    pileTakeFor(characterId, bossCatalogId, period)?.let { (tokenId, quantity) ->
        return if (quantity > 0) Owed.Pieces(tokenId, quantity) else Owed.None
    }
    val world =
        Characters
            .selectAll()
            .where { Characters.id eq characterId }
            .first()[Characters.worldType]
    val amounts =
        TokenClearAmount
            .selectAll()
            .where { (TokenClearAmount.bossCatalogId eq bossCatalogId) and (TokenClearAmount.world eq world) }
            .associateBy { it[TokenClearAmount.difficulty] }
    val (config, alone) = configFor(characterId, bossCatalogId, period) ?: (null to false)
    // build.py refuses a boss with a mode nobody counted, so a miss on a boss that has rows is the
    // catalog and the config disagreeing about which modes exist. Refused rather than read as none.
    val amount = config?.get(Party.difficulty)?.let { amounts[it] }
    return when {
        // A boss that drops no Eternal pieces at any mode.
        amounts.isEmpty() -> Owed.None
        amount == null -> Owed.Gap(PieceSyncGap.NO_DIFFICULTY)
        amount[TokenClearAmount.quantity] == 0 -> Owed.None
        amount[TokenClearAmount.pooled] && !alone -> Owed.Gap(PieceSyncGap.PARTY_LOOT)
        else -> Owed.Pieces(amount[TokenClearAmount.tokenCatalogId], amount[TokenClearAmount.quantity])
    }
}

/**
 * The config a clear in [period] is read against, and whether it was a run alone. Null when the
 * character has none that says anything about that period.
 *
 * A one-off that is not on [period] is an earlier week's temp party, which keeps the pair's slot
 * (one config per pair) without saying anything about now. A clear then was run alone, at the mode
 * the config was left on: one difficulty, last writer wins. A standing party skipped that week is
 * not read as a solo run: who was there is not known.
 */
private fun configFor(
    characterId: Uuid,
    bossCatalogId: Uuid,
    period: LocalDate,
): Pair<ResultRow, Boolean>? {
    val held =
        Party
            .selectAll()
            .where { (Party.characterId eq characterId) and (Party.bossCatalogId eq bossCatalogId) }
            .firstOrNull()
            ?.takeIf { it[Party.standing] }
    val runs = held != null && runsInPeriod(held[Party.id], held[Party.oneOff], period)
    val aloneAfterTemp = held != null && held[Party.oneOff] && !runs
    return held?.takeIf { runs || aloneAfterTemp }?.let { it to (it[Party.solo] || aloneAfterTemp) }
}

private fun countRow(
    characterId: Uuid,
    tokenId: Uuid,
): ResultRow? =
    CharacterTokenCount
        .selectAll()
        .where { (CharacterTokenCount.characterId eq characterId) and (CharacterTokenCount.tokenCatalogId eq tokenId) }
        .firstOrNull()

private fun give(
    characterId: Uuid,
    bossCatalogId: Uuid,
    period: LocalDate,
    owed: Owed.Pieces,
    now: Instant,
    capture: CaptureCounts?,
) {
    val row = countRow(characterId, owed.tokenId)
    // The capture that read this clear also read this count, so the drop is already in it.
    val readByCapture =
        when {
            capture == null -> false
            row == null -> capture.inventoryComplete
            else -> row[CharacterTokenCount.sourceScreenshotId] == capture.screenshotId
        }
    val after = if (readByCapture) null else (row?.get(CharacterTokenCount.quantity) ?: 0) + owed.quantity
    if (after != null) writeTokenCount(characterId, owed.tokenId, after, now)
    PieceClearCredit.insert {
        it[PieceClearCredit.characterId] = characterId
        it[PieceClearCredit.bossCatalogId] = bossCatalogId
        it[periodStart] = period
        it[tokenCatalogId] = owed.tokenId
        it[quantity] = owed.quantity
        it[creditedAt] = now
        it[countAfter] = after
    }
}

/**
 * Subtracts what [credit] added from the count as it stands now, and forgets it.
 *
 * False, touching nothing, when the sync never added to the count, a capture has read it since, or
 * it holds fewer than were added (so where they went is a guess). The credit row then stays, so
 * ticking the clear again cannot add it a second time.
 */
private fun takeBack(
    credit: ResultRow,
    now: Instant,
): Boolean {
    val characterId = credit[PieceClearCredit.characterId]
    val tokenId = credit[PieceClearCredit.tokenCatalogId]
    val added = credit[PieceClearCredit.quantity]
    // writeTokenCount clears the screenshot, so a non-null one is a capture since the credit.
    val row =
        countRow(characterId, tokenId)?.takeIf {
            credit[PieceClearCredit.countAfter] != null && it[CharacterTokenCount.sourceScreenshotId] == null
        }
    val held = row?.get(CharacterTokenCount.quantity) ?: 0
    if (row == null || held < added) return false
    writeTokenCount(characterId, tokenId, held - added, now)
    PieceClearCredit.deleteWhere {
        (PieceClearCredit.characterId eq characterId) and
            (PieceClearCredit.bossCatalogId eq credit[PieceClearCredit.bossCatalogId]) and
            (PieceClearCredit.periodStart eq credit[PieceClearCredit.periodStart])
    }
    return true
}

/** A cleared boss whose pieces are not in the inventory, and why. */
@Serializable
data class PieceSyncGapResponse(
    val characterId: String,
    val characterName: String,
    val bossKey: String,
    val bossName: String,
    val reason: PieceSyncGap,
)

/**
 * This period's cleared bosses, in the world being shown, whose pieces the sync did not add.
 *
 * Empty while the sync is off: nothing was promised, so nothing is missing.
 */
internal fun pieceSyncGapsFor(
    userId: String,
    now: Instant,
): List<PieceSyncGapResponse> {
    if (!syncEnabled(userId)) return emptyList()
    val pieceBosses =
        TokenClearAmount.select(TokenClearAmount.bossCatalogId).withDistinct().map {
            it[TokenClearAmount.bossCatalogId]
        }
    return BossClear
        .innerJoin(Characters)
        .innerJoin(BossCatalog)
        .selectAll()
        .where {
            (Characters.userId eq userId) and inActiveWorld(userId) and (BossClear.cleared eq true) and
                (BossClear.bossCatalogId inList pieceBosses)
        }.filter { it[BossClear.periodStart] == periodStartFor(it[BossCatalog.reset], now) }
        .sortedWith(compareBy({ it[Characters.name] }, { it[BossCatalog.sortOrder] }))
        .mapNotNull { row ->
            val characterId = row[BossClear.characterId]
            val bossId = row[BossClear.bossCatalogId]
            val period = row[BossClear.periodStart]
            val credited =
                !PieceClearCredit
                    .selectAll()
                    .where {
                        (PieceClearCredit.characterId eq characterId) and
                            (PieceClearCredit.bossCatalogId eq bossId) and
                            (PieceClearCredit.periodStart eq period)
                    }.empty()
            val owed = if (credited) Owed.None else owedFor(characterId, bossId, period)
            val reason =
                when (owed) {
                    is Owed.Gap -> owed.gap
                    is Owed.Pieces -> PieceSyncGap.BEFORE_SYNC
                    Owed.None -> null
                } ?: return@mapNotNull null
            PieceSyncGapResponse(
                characterId = characterId.toString(),
                characterName = row[Characters.name],
                bossKey = row[BossCatalog.bossKey],
                bossName = row[BossCatalog.name],
                reason = reason,
            )
        }
}
