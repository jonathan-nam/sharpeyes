package com.sharpeyes.backend.parties

import com.sharpeyes.backend.bosses.weekOf
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.Notification
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.PartyMember
import com.sharpeyes.backend.db.PartyWeekSeat
import com.sharpeyes.backend.events.Topic
import com.sharpeyes.backend.events.publish
import com.sharpeyes.backend.notifications.NotificationKind
import com.sharpeyes.backend.notifications.notify
import kotlinx.datetime.DateTimeUnit
import kotlinx.datetime.LocalDate
import kotlinx.datetime.minus
import kotlinx.datetime.plus
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import org.jetbrains.exposed.v1.core.JoinType
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.core.isNull
import org.jetbrains.exposed.v1.core.neq
import org.jetbrains.exposed.v1.jdbc.insert
import org.jetbrains.exposed.v1.jdbc.selectAll
import org.jetbrains.exposed.v1.jdbc.update
import kotlin.time.Instant
import kotlin.uuid.Uuid

// A character held by one party for a boss and wanted by another. One regular party per character
// per boss (V100), so a character moves rather than sitting in two, and only its player moves it:
// answering the ask PartyInvites.kt sends. Nothing here guesses which party is real. Inside a
// transaction, like the rest.
//
// The party it leaves keeps every week it ran: its roster is frozen onto all of them first, so a drop
// logged late still splits with the character in it. The owner left behind is told only that it left,
// never where to, since they need not be friends with the party it went to.

/** The regular party other than [except] holding [characterId] for [bossId], the same reading as V100. */
internal fun holderOf(
    characterId: Uuid,
    bossId: Uuid,
    except: Uuid,
): Holder? {
    val regular = { (Party.standing eq true) and (Party.solo eq false) and (Party.oneOff eq false) }
    val own =
        Party
            .selectAll()
            .where {
                (Party.characterId eq characterId) and (Party.bossCatalogId eq bossId) and (Party.id neq except) and
                    regular()
            }.firstOrNull()
    if (own != null) return Holder(own[Party.id], own = true)
    return PartyMember
        .join(Party, JoinType.INNER, PartyMember.partyId, Party.id)
        .selectAll()
        .where {
            (PartyMember.linkedCharacterId eq characterId) and (PartyMember.standing eq true) and
                (Party.bossCatalogId eq bossId) and (Party.id neq except) and regular()
        }.firstOrNull()
        ?.let { Holder(it[Party.id], own = false) }
}

/** Whether [characterId] is already in a regular party for [bossId] other than [except]. */
internal fun inPartyFor(
    characterId: Uuid,
    bossId: Uuid,
    except: Uuid,
): Boolean = holderOf(characterId, bossId, except) != null

/** Whether [partyId] has a record of [characterId] running [week]: a drop or a clear, with it in the roster. */
internal fun recordedIn(
    partyId: Uuid,
    characterId: Uuid,
    week: LocalDate,
    now: Instant,
): Boolean {
    val config = Party.selectAll().where { Party.id eq partyId }.first()
    val written = week in weeksAlreadyWritten(config, bossResetOf(config[Party.bossCatalogId]), now)
    val itsParty = config[Party.characterId] == characterId
    val ranIn = { seatOf(partyId, characterId)?.let { it in rosterFor(partyId, week) } == true }
    return written && (itsParty || ranIn())
}

private fun seatOf(
    partyId: Uuid,
    characterId: Uuid,
): Uuid? =
    PartyMember
        .selectAll()
        .where { (PartyMember.partyId eq partyId) and (PartyMember.linkedCharacterId eq characterId) }
        .firstOrNull()
        ?.get(PartyMember.id)

/**
 * A friend's character run with somebody else for [week] only: its party keeps it, and that week
 * is written as having run without it. Its owner is told the character was away, not where.
 */
internal fun lendForWeek(
    seat: FriendSeat,
    week: LocalDate,
    now: Instant,
) {
    val holder = seat.holder ?: return
    val config = Party.selectAll().where { Party.id eq holder }.first()
    val ownCharacterId = config[Party.characterId]
    val own = ownSeatName(ownCharacterId).lowercase()
    val ran =
        rosterNamesFor(
            holder,
            week,
        ).filterNot { it.lowercase() == own || it.equals(seat.name, ignoreCase = true) }
    saveWeekRoster(holder, ownCharacterId, week, ran, SeatContext(config[Party.userId], emptyMap(), now))
    val payload =
        buildJsonObject {
            put("character", seat.name)
            put("boss", bossNameOf(holder))
            put("partyId", holder.toString())
        }
    notify(config[Party.userId], NotificationKind.CHARACTER_AWAY, now, holder, userOf(seat.characterId), payload)
}

/**
 * Takes [characterId] out of [holderId], its player having said to move it. True when it already ran
 * with that party this week, so the move counts from next week and the new party must not claim it
 * for this one.
 */
internal fun moveOut(
    holderId: Uuid,
    characterId: Uuid,
    now: Instant,
): Boolean {
    val config = Party.selectAll().where { Party.id eq holderId }.first()
    val thisWeek = currentWeek()
    val ranHere = recordedIn(holderId, characterId, thisWeek, now)
    freezeWeeks(holderId, if (ranHere) thisWeek else thisWeek.minus(1, DateTimeUnit.WEEK))
    val seat =
        PartyMember
            .selectAll()
            .where {
                (PartyMember.partyId eq holderId) and (PartyMember.linkedCharacterId eq characterId) and
                    (PartyMember.standing eq true)
            }.first()
    val name = seat[PartyMember.name]
    takeOutSeats(config, listOf(seat[PartyMember.id] to name), now)
    noteLeft(config[Party.userId], userOf(characterId), name, bossNameOf(holderId), holderId, now)
    return ranHere
}

/**
 * Writes the roster every week from the party's start through [through] reads now, for each week not
 * already spelled out. A week nobody spelled out reads the standing roster, so without this a seat
 * leaving would rewrite every such week, and a drop logged late would split without it.
 */
internal fun freezeWeeks(
    partyId: Uuid,
    through: LocalDate,
) {
    val since = Party.selectAll().where { Party.id eq partyId }.first()[Party.partySince]
    val spelled = weeksSpelledOutFor(partyId)
    generateSequence(weekOf(todayIn(since))) { it.plus(1, DateTimeUnit.WEEK) }
        .takeWhile { it <= through }
        .filterNot { it in spelled }
        .forEach { week -> freezeWeek(partyId, week) }
}

/** Spells [week] out as the roster it reads now. */
internal fun freezeWeek(
    partyId: Uuid,
    week: LocalDate,
) {
    rosterFor(partyId, week).forEach { seatId ->
        PartyWeekSeat.insert {
            it[PartyWeekSeat.partyId] = partyId
            it[weekStart] = week
            it[memberId] = seatId
        }
    }
}

private fun bossNameOf(partyId: Uuid): String =
    Party
        .innerJoin(BossCatalog)
        .selectAll()
        .where { Party.id eq partyId }
        .first()[BossCatalog.name]

/**
 * Tells [owner] that [character] left their [boss] party. Folded into an unread note from today about
 * the same character, so a player switching several bosses at once is one note, not one per boss.
 */
private fun noteLeft(
    owner: String,
    player: String,
    character: String,
    boss: String,
    partyId: Uuid,
    now: Instant,
) {
    val today = todayIn(now)
    val earlier =
        Notification
            .selectAll()
            .where {
                (Notification.userId eq owner) and (Notification.kind eq NotificationKind.CHARACTER_LEFT) and
                    (Notification.actorId eq player) and Notification.readAt.isNull()
            }.firstOrNull { row ->
                todayIn(row[Notification.createdAt]) == today &&
                    row[Notification.payload].jsonObject["character"]?.jsonPrimitive?.content == character
            }
    if (earlier == null) {
        val payload =
            buildJsonObject {
                put("character", character)
                put("bosses", JsonArray(listOf(JsonPrimitive(boss))))
                put("partyId", partyId.toString())
            }
        notify(owner, NotificationKind.CHARACTER_LEFT, now, partyId, player, payload)
        return
    }
    val payload = earlier[Notification.payload].jsonObject
    val bosses = payload["bosses"]?.jsonArray.orEmpty() + JsonPrimitive(boss)
    Notification.update({ Notification.id eq earlier[Notification.id] }) {
        it[Notification.payload] = JsonObject(payload + ("bosses" to JsonArray(bosses)))
        it[createdAt] = now
    }
    publish(listOf(owner), Topic.NOTIFICATIONS)
}
