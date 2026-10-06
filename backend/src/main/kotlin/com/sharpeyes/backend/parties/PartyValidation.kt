package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.periodOf
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// What a config has to be true of before it is written. Split from the routes only for size; the
// rules themselves are the interesting part, and they refuse rather than repair.

/**
 * Why this config cannot be created, or null.
 *
 * Refuses rather than repairs: a second config for the same character and boss, a boss the catalog
 * does not have, or somebody else's character would each save something the user did not ask for.
 * Must run inside a transaction.
 */
internal fun validateNewParty(
    request: SavePartyRequest,
    userId: String,
    characterId: Uuid?,
    bossCatalogId: Uuid?,
    now: Instant,
): String? {
    val owned =
        characterId != null &&
            Characters
                .selectAll()
                .where { (Characters.id eq characterId) and (Characters.userId eq userId) }
                .empty()
                .not()
    val taken =
        characterId != null &&
            bossCatalogId != null &&
            Party
                .selectAll()
                .where {
                    (Party.characterId eq characterId) and
                        (Party.bossCatalogId eq bossCatalogId) and
                        (Party.standing eq true)
                }.empty()
                .not()

    return when {
        !owned -> "characterId must be one of your characters"
        bossCatalogId == null -> "unknown bossKey"
        taken -> "that character already has a party for this boss"
        else ->
            validateDifficulty(bossCatalogId, request.difficulty)
                ?: validateMinutes(request.minutes)
                ?: validateMembers(request.members)
                ?: validateShares(request.shares, characterId, request.members)
                ?: validateBossRoster(
                    userId,
                    bossCatalogId,
                    exclude = null,
                    rosterOf(characterId, request.members),
                    now,
                    request.oneOff,
                )
    }
}

/**
 * Why this config cannot be written over an existing one, or null.
 *
 * Read against the config's OWN character and boss rather than the request's. Neither is editable,
 * so a payload naming another one must not widen which difficulties are allowed, nor move the seat
 * the roster rule is looking for.
 *
 * [oneOff] is which kind the config will be once this is written, which the caller knows and this
 * cannot: the takeover path is free to make a standing config a one-off, and an ordinary edit
 * cannot, so reading either the request or the row would be wrong down one of the two.
 *
 * Must run inside a transaction.
 */
internal fun validateSavedParty(
    userId: String,
    partyId: Uuid,
    request: SavePartyRequest,
    now: Instant,
    oneOff: Boolean,
): String? {
    val bossCatalogId = bossIdOfParty(partyId)
    return bossCatalogId?.let { validateDifficulty(it, request.difficulty) }
        ?: validateMinutes(request.minutes)
        ?: validateMembers(request.members, allowNone = true)
        ?: validateShares(request.shares, characterIdOfParty(partyId), request.members)
        ?: bossCatalogId?.let {
            validateBossRoster(
                userId,
                it,
                exclude = partyId,
                rosterOf(characterIdOfParty(partyId), request.members),
                now,
                oneOff,
            )
        }
}

/**
 * Why this week's roster cannot stand against the boss's other configs, or null.
 *
 * The same rule as validateBossRoster, against who actually RAN rather than the usual roster, which
 * is the one thing a week can say that a config cannot. Read through rostersFor on purpose: a party
 * that dropped somebody this week is not holding their clear, so lending them to another party for
 * the same boss is allowed, and only checking the standing rosters would refuse it.
 *
 * A config that was not on in this period did not run it, so it holds nobody's clear in it. Both
 * kinds count here, unlike validateBossRoster: the question is one week rather than the arrangement,
 * and a week somebody took the party off is a week they were free to run it with somebody else.
 *
 * Must run inside a transaction.
 */
internal fun validateWeekRoster(
    userId: String,
    bossCatalogId: Uuid,
    exclude: Uuid,
    week: LocalDate,
    roster: List<String>,
): String? {
    val wanted = roster.map { it.trim().lowercase() }.toSet()
    val period = bossResetOf(bossCatalogId)?.let { periodOf(it, week) }
    val ownerOf =
        if (wanted.isEmpty() || period == null) {
            emptyMap()
        } else {
            Party
                .selectAll()
                .where {
                    (Party.userId eq userId) and (Party.bossCatalogId eq bossCatalogId) and (Party.standing eq true)
                }.filter { it[Party.id] != exclude }
                .filter { runsInPeriod(it[Party.id], it[Party.oneOff], period) }
                .associate { it[Party.id] to it[Party.characterId] }
        }

    val ran = if (ownerOf.isEmpty()) emptyList() else rostersFor(ownerOf.keys.toList(), week).values.flatten()
    val clash =
        if (ran.isEmpty()) {
            null
        } else {
            PartyMember
                .selectAll()
                .where { PartyMember.id inList ran }
                .firstOrNull { it[PartyMember.name].trim().lowercase() in wanted }
        }

    return clash?.let {
        val owner = ownerOf[it[PartyMember.partyId]]?.let(::characterName)
        "${it[PartyMember.name]} already ran this boss with your $owner party this week"
    }
}

/** A config's seats as one list: your character, then the people it runs the boss with. */
internal fun rosterOf(
    characterId: Uuid?,
    members: List<String>,
): List<String> = listOfNotNull(characterId?.let(::characterName)) + members

private fun characterName(characterId: Uuid): String? =
    Characters
        .selectAll()
        .where { Characters.id eq characterId }
        .firstOrNull()
        ?.get(Characters.name)

/**
 * Why this run time cannot be stored, or null.
 *
 * Null passes, meaning nobody has timed this party. Zero passes too: a boss walked through in
 * under a minute is a real thing to say, and rounding it up to "at least one" would be this app
 * disagreeing with the person who timed it.
 *
 * The ceiling is a typo guard, not a rule about bossing. Refusing rather than clamping, because a
 * 3000 silently kept as 600 would order somebody's night around a number they never entered.
 */
internal fun validateMinutes(minutes: Int?): String? =
    when {
        minutes == null -> null
        minutes < 0 -> "minutes cannot be negative"
        minutes > MAX_RUN_MINUTES -> "minutes must be at most $MAX_RUN_MINUTES"
        else -> null
    }

/**
 * Why this difficulty cannot stand against this boss, or null.
 *
 * Null passes: not saying which mode you run is allowed, and is what every config predating the
 * column says. Saying one the boss does not have is refused rather than dropped, because a config
 * reading "Normal Black Mage" is a fact somebody would believe. The modes come from the catalog
 * row (catalog/bosses.yaml), so a new mode is one edit there and no code change here.
 *
 * Must run inside a transaction.
 */
internal fun validateDifficulty(
    bossCatalogId: Uuid,
    difficulty: String?,
): String? {
    if (difficulty == null) return null
    val modes =
        BossCatalog
            .selectAll()
            .where { BossCatalog.id eq bossCatalogId }
            .firstOrNull()
            ?.get(BossCatalog.difficulties)
            .orEmpty()
    return if (difficulty in modes) null else "difficulty must be one of: ${modes.joinToString(", ")}"
}

/**
 * Why this roster cannot stand against the boss's other configs, or null.
 *
 * A character clears a boss once a period, so naming one in two configs for the same boss states
 * something the game cannot do: only one of the two can ever run. Run Order had to drop one of them
 * and could say nothing useful about which, so the pair is refused at the point it is written.
 *
 * `exclude` is the config being edited, which is not competition with itself.
 *
 * Owner and members are one list here. A character occupies its slot whichever end of a config it
 * sits at, and letting it own one config and sit in another for the same boss is the same clash
 * through a different door.
 *
 * Only seats that are still IN a roster compete. A seat somebody left is retired rather than
 * deleted, because a payout or a past week points at it (see retireOrDelete), and a retired seat is
 * not running the boss with anybody. Counting one refused a roster over somebody the party no
 * longer has, naming a config the user could look straight at and not find them in.
 *
 * Which of the others count depends on what is being written, because the two are only in each
 * other's way in a period they would both run. A STANDING config runs in every period from here on,
 * so anything that has not stopped for good competes with it: a one-off whose period has passed
 * holds nobody, and a config merely skipped this week still does. That is the difference between
 * not running once and not running again.
 *
 * [oneOff] is a single night, so only its own period is asked about, and a config skipped in that
 * period is not running the boss then. Same fact as validateWeekRoster's, read against the period
 * rather than the week: a party taken off for the week is one its members were free to run the boss
 * with somebody else. Without it, taking a party off this week and running its boss with a different
 * pair the same week was refused, and the only way through was retiring the standing config.
 *
 * Both ways of arming a spent one-off again come back through this rule (takeOverParty and
 * setSkipRoute), so the two can still never be on at the same time.
 *
 * Must run inside a transaction.
 */
internal fun validateBossRoster(
    userId: String,
    bossCatalogId: Uuid,
    exclude: Uuid?,
    roster: List<String>,
    now: Instant,
    oneOff: Boolean,
): String? {
    val wanted = roster.map { it.trim().lowercase() }.toSet()
    if (wanted.isEmpty()) return null
    // The one period a one-off runs in, or null for a config that runs in all of them. A boss whose
    // reset cannot be read leaves it null, which asks the stricter question rather than guessing a
    // period and letting a real clash through.
    val period = if (oneOff) bossResetOf(bossCatalogId)?.let { periodStartFor(it, now) } else null

    // Every live config this account has on this boss, minus the one being written.
    val others =
        Party
            .selectAll()
            .where {
                (Party.userId eq userId) and
                    (Party.bossCatalogId eq bossCatalogId) and
                    (Party.standing eq true)
            }.filter { exclude == null || it[Party.id] != exclude }
            // A query per row, and there are usually none. Every candidate is on the same boss,
            // hence the same cadence, so the one period answers for all of them.
            .filter {
                val other = it[Party.id]
                if (period == null) {
                    !isSpentOneOff(other, now)
                } else {
                    runsInPeriod(other, it[Party.oneOff], period)
                }
            }

    // Compared in Kotlin rather than SQL: it is a handful of rows per boss, and the case-folding
    // then matches validateMembers' rather than Postgres's collation.
    val clash =
        others.firstNotNullOfOrNull { other ->
            claimedSeats(other[Party.id], other[Party.oneOff], now)
                .firstOrNull { it.trim().lowercase() in wanted }
                ?.let { it to characterName(other[Party.characterId]) }
        }

    return clash?.let { (name, owner) -> "$name is already in your $owner party for this boss" }
}
