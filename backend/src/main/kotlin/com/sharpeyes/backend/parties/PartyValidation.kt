package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.periodOf
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
): String? =
    validateNewPartyRules(request, userId, characterId, bossCatalogId)
        ?: bossCatalogId?.let {
            validateBossRoster(
                userId,
                it,
                exclude = null,
                rosterOf(characterId, request.members),
                now,
                request.oneOff,
            )
        }

/**
 * The same rules, minus the roster clash.
 *
 * Split out because the clash is the one refusal a user can answer: they are told which party holds
 * the character and can agree to move them. Everything here is a request that cannot be written at
 * all, so the routes ask for these first and never offer a move over a bad difficulty. See
 * releaseFrom on SavePartyRequest.
 */
internal fun validateNewPartyRules(
    request: SavePartyRequest,
    userId: String,
    characterId: Uuid?,
    bossCatalogId: Uuid?,
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
                ?: validateLooter(request.looterName, characterId, request.members)
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
): String? =
    validateSavedPartyRules(partyId, request)
        ?: bossIdOfParty(partyId)?.let {
            validateBossRoster(
                userId,
                it,
                exclude = partyId,
                rosterOf(characterIdOfParty(partyId), request.members),
                now,
                oneOff,
            )
        }

/** The same rules, minus the roster clash. See validateNewPartyRules. */
internal fun validateSavedPartyRules(
    partyId: Uuid,
    request: SavePartyRequest,
): String? {
    val bossCatalogId = bossIdOfParty(partyId)
    return bossCatalogId?.let { validateDifficulty(it, request.difficulty) }
        ?: validateMinutes(request.minutes)
        ?: validateMembers(request.members)
        ?: validateShares(request.shares, characterIdOfParty(partyId), request.members)
        ?: validateLooter(request.looterName, characterIdOfParty(partyId), request.members)
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
 * Why these standing share counts cannot be written, or null.
 *
 * A name the party does not have is refused rather than ignored: silently dropping it would leave
 * the party believing a seat takes double when nothing recorded it.
 */
internal fun validateShares(
    shares: Map<String, Int>,
    ownCharacterId: Uuid?,
    members: List<String>,
): String? {
    if (shares.isEmpty()) return null
    val named =
        (listOfNotNull(ownCharacterId?.let(::ownSeatName)) + members)
            .map { it.trim().lowercase() }
            .toSet()
    // Matched the way writeMembers matches them, or a name that differs only in case would be
    // counted as the one share it defaults to rather than the zero that was sent.
    val byName = shares.mapKeys { (name, _) -> name.trim().lowercase() }
    return when {
        byName.keys.any { it !in named } -> "shares may only name somebody in this party"
        // Zero is a seat that takes nothing, which some parties agree: one member keeps the drop
        // and owes the others nothing, because they are there for something else. See V44.
        byName.values.any { it < 0 || it > MAX_SHARES } -> "a share count must be between 0 and $MAX_SHARES"
        // Everybody on zero is not an arrangement. It divides the pot by nothing, and the roster
        // sent is the whole party, so no absent name is going to make up the difference.
        named.sumOf { byName[it] ?: 1 } < 1 -> "somebody in the party has to take a share"
        else -> null
    }
}

/** The rules a config's roster has to keep, wherever it is being written. */
internal fun validateMembers(members: List<String>): String? {
    val names = members.map { it.trim() }
    return when {
        // Your own character is the config; the members are the others. Nobody else means a solo
        // run, and a solo run is not a party.
        names.isEmpty() -> "a party needs somebody else in it"
        names.size > MAX_PARTY_SIZE - 1 -> "a party holds at most $MAX_PARTY_SIZE including your character"
        names.any { it.isBlank() } -> "a member needs a character name"
        names.map { it.lowercase() }.distinct().size != names.size -> "the same character twice"
        else -> null
    }
}
