package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.Characters
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyPeriodDifficulty
import com.sharpeyes.backend.db.PartyPeriodRun
import com.sharpeyes.backend.db.PartyPeriodSkip
import com.sharpeyes.backend.db.PartyPiecePile
import com.sharpeyes.backend.db.PartyPieceTake
import com.sharpeyes.backend.db.PartyWeekSeat
import kotlinx.datetime.LocalDate
import org.jetbrains.exposed.v1.core.ResultRow
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.insertIgnore
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Instant
import kotlin.uuid.Uuid

// The parties half of an unlink's snapshot: each shared party, as a party of the reader's own, with
// every drop it held. See SharedSlice.kt. Inside a transaction, like the rest.

/** One party copied: where it went, and which seat there each seat here became. */
internal class PartyCopy(
    val source: Uuid,
    /** The source's drops as read, which are the ones copied. See SharedSlice.loot. */
    val sourceLoot: List<Uuid>,
    val target: Uuid,
    val seats: Map<Uuid, Uuid>,
    /** Weeks the reader's own copy of the run is kept in, so the owner's drops of them are not copied. */
    val keepTheirs: Set<LocalDate>,
)

/**
 * Copies [source] into [reader]'s book, led by their character in it, or into the config they
 * already have for that character and boss (one per pair, idx_party_character_boss).
 *
 * Merging is the duplicate case the Drop Log already resolves for the owner (lib/duplicate-runs.ts):
 * the owner's copy of a week counts. So the reader's own drops of a week the owner also logged are
 * removed and the owner's copied in, unless one of theirs has been sold, kept or settled, which no
 * snapshot should undo: then that week keeps theirs. Null when no seat is the reader's.
 */
internal fun copyParty(
    source: Uuid,
    sourceLoot: List<Uuid>,
    reader: String,
    now: Instant,
): PartyCopy? {
    val party = Party.selectAll().where { Party.id eq source }.single()
    val readerCharacters = charactersOf(reader).toSet()
    val seats =
        PartyMember
            .selectAll()
            .where { PartyMember.partyId eq source }
            .orderBy(PartyMember.position)
            .toList()
    val lead =
        seats.firstNotNullOfOrNull { seat ->
            seat[PartyMember.linkedCharacterId]?.takeIf { it in readerCharacters }
        }
    val existing =
        lead?.let {
            Party
                .selectAll()
                .where { (Party.characterId eq it) and (Party.bossCatalogId eq party[Party.bossCatalogId]) }
                .firstOrNull()
                ?.get(Party.id)
        }
    return when {
        lead == null -> null
        existing == null -> {
            val target = newParty(party, reader, lead, now)
            val map =
                seats.associate {
                    it[PartyMember.id] to
                        insertCopiedSeat(
                            target,
                            it,
                            readerCharacters,
                            it[PartyMember.position],
                            it[PartyMember.standing],
                        )
                }
            copyPeriods(source, target)
            copyWeekRows(source, target, map)
            copyPieces(source, target, map)
            PartyCopy(source, sourceLoot, target, map, emptySet())
        }
        else -> {
            val map = mergeSeats(existing, seats, readerCharacters)
            val keepTheirs = resolveDuplicateWeeks(source, sourceLoot, existing, map)
            copyPeriods(source, existing)
            copyPieces(source, existing, map)
            PartyCopy(source, sourceLoot, existing, map, keepTheirs)
        }
    }
}

/** The reader's config for [lead], standing and roster-dated as the owner's was. */
private fun newParty(
    party: ResultRow,
    reader: String,
    lead: Uuid,
    now: Instant,
): Uuid {
    val id = Uuid.random()
    Party.insert {
        it[Party.id] = id
        it[userId] = reader
        it[characterId] = lead
        it[bossCatalogId] = party[Party.bossCatalogId]
        it[difficulty] = party[Party.difficulty]
        it[minutes] = party[Party.minutes]
        it[solo] = false
        it[oneOff] = party[Party.oneOff]
        it[standing] = party[Party.standing]
        it[partySince] = party[Party.partySince]
        it[createdAt] = now
        it[updatedAt] = now
    }
    return id
}

/**
 * One seat of the owner's party, as the reader's party seats it. A seat of the reader's is their
 * character; the owner's own characters and everybody else become seats by name, linked to nobody,
 * with the sprite a named seat carries.
 */
private fun insertCopiedSeat(
    target: Uuid,
    seat: ResultRow,
    readerCharacters: Set<Uuid>,
    position: Int,
    standing: Boolean,
): Uuid {
    val mine = seat[PartyMember.linkedCharacterId]?.takeIf { it in readerCharacters }
    val ownersCharacter = seat[PartyMember.characterId]
    val sprite =
        ownersCharacter?.let { id ->
            Characters
                .selectAll()
                .where { Characters.id eq id }
                .firstOrNull()
                ?.get(Characters.spriteImgUrl)
        } ?: seat[PartyMember.spriteImgUrl]
    val id = Uuid.random()
    PartyMember.insert {
        it[PartyMember.id] = id
        it[partyId] = target
        it[name] = seat[PartyMember.name]
        it[characterId] = mine
        it[linkedCharacterId] = null
        it[PartyMember.position] = position
        it[PartyMember.standing] = standing
        it[shares] = seat[PartyMember.shares]
        it[pieceShares] = seat[PartyMember.pieceShares]
        it[spriteImgUrl] = if (mine == null) sprite else null
        it[spriteRefreshedAt] = null
    }
    return id
}

/**
 * Each seat of the owner's party matched to one of [target]'s, by character or by name, or added as
 * a seat that is not in the usual roster: the copied weeks name it, and the config's own roster from
 * here on is the reader's to say.
 */
private fun mergeSeats(
    target: Uuid,
    seats: List<ResultRow>,
    readerCharacters: Set<Uuid>,
): Map<Uuid, Uuid> {
    val theirs = PartyMember.selectAll().where { PartyMember.partyId eq target }.toList()
    var next = (theirs.maxOfOrNull { it[PartyMember.position] } ?: -1) + 1
    return seats.associate { seat ->
        val mine = seat[PartyMember.linkedCharacterId]?.takeIf { it in readerCharacters }
        val match =
            theirs.firstOrNull { mine != null && it[PartyMember.characterId] == mine }
                ?: theirs.firstOrNull { it[PartyMember.name].equals(seat[PartyMember.name], ignoreCase = true) }
        seat[PartyMember.id] to
            (match?.get(PartyMember.id) ?: insertCopiedSeat(target, seat, readerCharacters, next++, standing = false))
    }
}

/** Skips, one-off runs and per-period modes. A period the target already says something about keeps it. */
private fun copyPeriods(
    source: Uuid,
    target: Uuid,
) {
    PartyPeriodSkip.selectAll().where { PartyPeriodSkip.partyId eq source }.forEach { row ->
        PartyPeriodSkip.insertIgnore {
            it[partyId] = target
            it[periodStart] = row[PartyPeriodSkip.periodStart]
            it[createdAt] = row[PartyPeriodSkip.createdAt]
        }
    }
    PartyPeriodRun.selectAll().where { PartyPeriodRun.partyId eq source }.forEach { row ->
        PartyPeriodRun.insertIgnore {
            it[partyId] = target
            it[periodStart] = row[PartyPeriodRun.periodStart]
            it[createdAt] = row[PartyPeriodRun.createdAt]
        }
    }
    PartyPeriodDifficulty.selectAll().where { PartyPeriodDifficulty.partyId eq source }.forEach { row ->
        PartyPeriodDifficulty.insertIgnore {
            it[partyId] = target
            it[periodStart] = row[PartyPeriodDifficulty.periodStart]
            it[difficulty] = row[PartyPeriodDifficulty.difficulty]
        }
    }
}

/** The weeks spelled out with their own roster, seat for seat. */
private fun copyWeekRows(
    source: Uuid,
    target: Uuid,
    seats: Map<Uuid, Uuid>,
) {
    PartyWeekSeat.selectAll().where { PartyWeekSeat.partyId eq source }.forEach { row ->
        val seat = seats[row[PartyWeekSeat.memberId]] ?: return@forEach
        PartyWeekSeat.insertIgnore {
            it[partyId] = target
            it[weekStart] = row[PartyWeekSeat.weekStart]
            it[memberId] = seat
            it[shares] = row[PartyWeekSeat.shares]
        }
    }
}

/** Interactive piece piles and who took what of them (#718). A period already filed keeps its own. */
private fun copyPieces(
    source: Uuid,
    target: Uuid,
    seats: Map<Uuid, Uuid>,
) {
    PartyPiecePile.selectAll().where { PartyPiecePile.partyId eq source }.forEach { row ->
        PartyPiecePile.insertIgnore {
            it[partyId] = target
            it[periodStart] = row[PartyPiecePile.periodStart]
            it[tokenCatalogId] = row[PartyPiecePile.tokenCatalogId]
            it[difficulty] = row[PartyPiecePile.difficulty]
            it[total] = row[PartyPiecePile.total]
            it[stackSize] = row[PartyPiecePile.stackSize]
            it[filedAt] = row[PartyPiecePile.filedAt]
        }
    }
    PartyPieceTake.selectAll().where { PartyPieceTake.partyId eq source }.forEach { row ->
        val seat = seats[row[PartyPieceTake.memberId]] ?: return@forEach
        PartyPieceTake.insertIgnore {
            it[partyId] = target
            it[periodStart] = row[PartyPieceTake.periodStart]
            it[memberId] = seat
            it[quantity] = row[PartyPieceTake.quantity]
        }
    }
}
