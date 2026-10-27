package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.PartyMember
import org.jetbrains.exposed.v1.core.SortOrder
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.notInList
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.uuid.Uuid

// A roster is ordered by seat position, so two seats sharing one come back in whatever order Postgres
// returns them: a one-off's night once read Pinewick before Baldrix on some reads and after on others.
// These two keep a party's positions unique.

/** The position after every seat the party has, retired ones included. */
internal fun nextSeatPosition(partyId: Uuid): Int =
    PartyMember
        .selectAll()
        .where { PartyMember.partyId eq partyId }
        .maxOfOrNull { it[PartyMember.position] }
        ?.plus(1) ?: 0

/** Moves every seat but [standing] after it, in the order they had. [standing] holds 0 until its size. */
internal fun seatOthersAfter(
    partyId: Uuid,
    standing: Collection<Uuid>,
) {
    PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.id notInList standing) }
        .orderBy(PartyMember.position to SortOrder.ASC, PartyMember.id to SortOrder.ASC)
        .map { it[PartyMember.id] }
        .forEachIndexed { index, seatId ->
            PartyMember.update({ PartyMember.id eq seatId }) { it[position] = standing.size + index }
        }
}
