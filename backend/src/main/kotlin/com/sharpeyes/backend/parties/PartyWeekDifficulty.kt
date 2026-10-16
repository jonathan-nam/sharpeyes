package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.periodOf
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyPeriodDifficulty
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.inList
import org.jetbrains.exposed.v1.jdbc.deleteWhere
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.upsert
import kotlin.uuid.Uuid

// The mode a party ran at in one period. The config's difficulty is the usual one; a period may say
// otherwise (Chaos Kalos run on Normal for a week a member was away) and the next period reverts.
// Every read about a particular period goes through difficultyIn, never Party.difficulty directly.
// See V82__party_period_difficulty.sql.
//
// Inside a transaction, like the rest.

/** The period's own mode for each of these parties, where one was said. */
internal fun periodDifficulties(
    partyIds: List<Uuid>,
    periodFor: (Uuid) -> LocalDate,
): Map<Uuid, String> {
    if (partyIds.isEmpty()) return emptyMap()
    return PartyPeriodDifficulty
        .selectAll()
        .where { PartyPeriodDifficulty.partyId inList partyIds }
        .filter { it[PartyPeriodDifficulty.periodStart] == periodFor(it[PartyPeriodDifficulty.partyId]) }
        .associate { it[PartyPeriodDifficulty.partyId] to it[PartyPeriodDifficulty.difficulty] }
}

/** The mode [config] ran at in [period]: the period's own when one was said, else the config's. */
internal fun difficultyIn(
    config: ResultRow,
    period: LocalDate,
): String? =
    PartyPeriodDifficulty
        .selectAll()
        .where {
            (PartyPeriodDifficulty.partyId eq config[Party.id]) and
                (PartyPeriodDifficulty.periodStart eq period)
        }.firstOrNull()
        ?.get(PartyPeriodDifficulty.difficulty) ?: config[Party.difficulty]

/** The same, for a date inside the period rather than its start. */
internal fun difficultyOn(
    config: ResultRow,
    on: LocalDate,
): String? {
    val reset = bossResetOf(config[Party.bossCatalogId]) ?: return config[Party.difficulty]
    return difficultyIn(config, periodOf(reset, on))
}

/**
 * Says which mode this party runs in [period]. The config's own mode, or null, is the period back at
 * the usual one, which is the absence of a row.
 */
internal fun setPeriodDifficulty(
    partyId: Uuid,
    period: LocalDate,
    difficulty: String?,
) {
    val usual =
        Party
            .selectAll()
            .where { Party.id eq partyId }
            .first()[Party.difficulty]
    if (difficulty == null || difficulty == usual) {
        PartyPeriodDifficulty.deleteWhere {
            (PartyPeriodDifficulty.partyId eq partyId) and (PartyPeriodDifficulty.periodStart eq period)
        }
    } else {
        PartyPeriodDifficulty.upsert {
            it[PartyPeriodDifficulty.partyId] = partyId
            it[periodStart] = period
            it[PartyPeriodDifficulty.difficulty] = difficulty
        }
    }
}
