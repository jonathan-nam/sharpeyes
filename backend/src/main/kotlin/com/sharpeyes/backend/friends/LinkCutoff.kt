package com.sharpeyes.backend.friends

import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Person
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.plus
import kotlinx.datetime.toLocalDateTime
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant

// Where two books meet. Accounts that each kept a book before linking each recorded their shared past
// already, so the other's copy of it is read across only from the day after the link (V99). An
// account with no book of its own has nothing to count twice and reads everything. Inside a
// transaction, like the rest.

/** Whether [userId] keeps a book of their own: any party or person. */
internal fun keepsBook(userId: String): Boolean =
    !Party.selectAll().where { Party.userId eq userId }.empty() ||
        !Person.selectAll().where { Person.userId eq userId }.empty()

/**
 * The first day read across for two accounts linking at [now], or null when one of them kept no
 * book. The link day itself is left out: both books may have logged it before the link.
 */
internal fun linkCutoff(
    a: String,
    b: String,
    now: Instant,
): LocalDate? =
    if (keepsBook(a) && keepsBook(b)) now.toLocalDateTime(TimeZone.UTC).date.plus(DatePeriod(days = 1)) else null

/** Sets [cutoff] on each side's person for the other. */
internal fun markLinked(
    a: String,
    b: String,
    cutoff: LocalDate?,
) {
    for ((owner, other) in listOf(a to b, b to a)) {
        Person.update({ (Person.userId eq owner) and (Person.linkedUserId eq other) }) { it[sharedFrom] = cutoff }
    }
}
