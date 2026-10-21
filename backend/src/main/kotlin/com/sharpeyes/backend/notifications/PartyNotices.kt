package com.sharpeyes.backend.notifications

import com.sharpeyes.backend.bosses.bossCatalog
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.events.ACTOR
import com.sharpeyes.backend.parties.LootResponse
import com.sharpeyes.backend.parties.PartyResponse
import com.sharpeyes.backend.parties.audienceOf
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.time.Clock
import kotlin.uuid.Uuid

// The bell's half of a change somebody else made to something you share: one entry per change, for
// everybody it reaches but the one who made it. Each carries what the bell draws it with (an icon
// and the facts its sentence is made of), so the list never has to read a party to say one line.
// Inside the writer's transaction, like notify(). Silent where nobody is known to have made it.

/** A drop's own facts, as every drop entry names it. */
private fun dropFacts(
    partyId: Uuid,
    loot: LootResponse,
): JsonObject =
    buildJsonObject {
        put("partyId", partyId.toString())
        put("lootId", loot.id)
        put("item", loot.name)
        put("icon", loot.iconUrl)
        put("boss", loot.bossKey?.let(::bossNameOf))
    }

private fun bossNameOf(key: String): String? = bossCatalog().firstOrNull { it.bossKey == key }?.name

private fun JsonObject.with(extra: JsonObject): JsonObject = JsonObject(this + extra)

/** Everybody [partyId] reaches but whoever is making this change. */
private fun tellParty(
    partyId: Uuid,
    kind: String,
    subject: Uuid?,
    payload: JsonObject,
) {
    val actor = ACTOR.get() ?: return
    val now = Clock.System.now()
    for (user in audienceOf(partyId) - actor) notify(user, kind, now, subject, actor, payload)
}

/** A drop of a party you are in sold, in mesos or in dollars. */
internal fun noticeSale(
    partyId: Uuid,
    loot: LootResponse,
) = tellParty(
    partyId,
    NotificationKind.SALE_RECORDED,
    Uuid.parse(loot.id),
    dropFacts(partyId, loot).with(
        buildJsonObject {
            put("amount", loot.saleAmount)
            put("usdCents", loot.saleUsdCents)
        },
    ),
)

/** A share of one drop marked paid, or taken back. */
internal fun noticeShareMarked(
    partyId: Uuid,
    loot: LootResponse,
    paid: Boolean,
) = tellParty(
    partyId,
    NotificationKind.SHARE_MARKED,
    Uuid.parse(loot.id),
    dropFacts(partyId, loot).with(buildJsonObject { put("paid", paid) }),
)

/** Who picked up which stacks of a coupon drop, said or corrected. */
internal fun noticeStacks(
    partyId: Uuid,
    loot: LootResponse,
) = tellParty(partyId, NotificationKind.STACKS_CHANGED, Uuid.parse(loot.id), dropFacts(partyId, loot))

/** A shared party's clear ticked or taken back, which is the whole party's run. */
internal fun noticeClear(
    party: PartyResponse,
    cleared: Boolean,
) {
    val boss = bossCatalog().firstOrNull { it.bossKey == party.bossKey }
    tellParty(
        Uuid.parse(party.id),
        NotificationKind.CLEAR_MARKED,
        null,
        buildJsonObject {
            put("partyId", party.id)
            put("boss", boss?.name)
            put("icon", boss?.iconUrl)
            put("difficulty", party.weekDifficulty ?: party.difficulty)
            put("cleared", cleared)
        },
    )
}

/**
 * A debt or payment written into a book two accounts share, for the other one of them.
 *
 * [personId] is the owner's person row for the member, which is who the row is filed under (none for
 * a holder that is not a person, who has nobody to tell). The
 * direction is said from the RECIPIENT's side: [amount] is the owner's book's signed figure (positive
 * is the member owing, or the member having paid), and the bell says who owes or paid whom.
 */
internal fun noticeLedger(
    personId: Uuid?,
    entry: String,
    amount: Long,
    note: String?,
) {
    val actor = ACTOR.get()
    val person = personId?.let { id -> Person.selectAll().where { Person.id eq id }.firstOrNull() }
    val owner = person?.get(Person.userId)
    val member = person?.get(Person.linkedUserId)
    val recipient = if (actor == owner) member else owner.takeIf { actor == member }
    if (actor == null || recipient == null) return
    // Positive in the owner's book runs from the member to the owner, whichever of them is told.
    val toRecipient = (amount > 0) == (recipient == owner)
    notify(
        recipient,
        NotificationKind.LEDGER_ENTRY,
        Clock.System.now(),
        null,
        actor,
        buildJsonObject {
            put("entry", entry)
            put("amount", kotlin.math.abs(amount))
            put("toYou", toRecipient)
            put("note", note)
        },
    )
}

/** Shares marked sent or offset for the lot, by an owner, for the member they were owed by or to. */
internal fun noticeSharesClosed(
    personId: String?,
    count: Int,
    how: String,
) {
    val actor = ACTOR.get()
    val id = personId?.let { Uuid.parseOrNull(it) }
    val member =
        if (actor == null || id == null) {
            null
        } else {
            Person
                .selectAll()
                .where { (Person.id eq id) and (Person.userId eq actor) }
                .firstOrNull()
                ?.get(Person.linkedUserId)
        } ?: return
    notify(
        member,
        NotificationKind.SHARE_MARKED,
        Clock.System.now(),
        null,
        actor,
        buildJsonObject {
            put("count", count)
            put("how", how)
            put("paid", true)
        },
    )
}
