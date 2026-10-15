package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.WEEKLY_CADENCE
import com.sharpeyes.backend.bosses.periodStartFor
import com.sharpeyes.backend.db.Party
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.ResultRow

/**
 * Whether this config ran as a party in [week]: somebody besides you was in it, as that week reads.
 *
 * A week with its own roster says so itself. Any other week reads the standing roster as it is
 * now, which only answered for that week if the config was already a standing party then: a solo
 * pool adopted, a retired config revived and a one-off made standing all change kind in place, and
 * today's seats must not be claimed for the weeks before. See V80__party_since.sql.
 */
internal fun ranAsPartyIn(
    row: ResultRow,
    week: LocalDate,
    seats: Int,
    spelledOut: Boolean,
    off: Boolean,
): Boolean =
    row[Party.standing] &&
        !off &&
        seats > 1 &&
        (spelledOut || (!row[Party.solo] && periodStartFor(WEEKLY_CADENCE, row[Party.partySince]) <= week))
