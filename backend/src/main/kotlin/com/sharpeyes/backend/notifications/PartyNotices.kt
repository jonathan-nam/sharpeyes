package com.sharpeyes.backend.notifications

import com.sharpeyes.backend.bosses.bossCatalog
import com.sharpeyes.backend.db.Party
import com.sharpeyes.backend.db.Person
import com.sharpeyes.backend.events.ACTOR
import com.sharpeyes.backend.parties.LootResponse
import com.sharpeyes.backend.parties.audienceOf
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import org.jetbrains.exposed.v1.core.and
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.select
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

/** Everybody [partyId] reaches but whoever is making this change, each with [forUser] added. */
private fun tellParty(
    partyId: Uuid,
    kind: String,
    subject: Uuid?,
    payload: JsonObject,
    forUser: (user: String, actor: String) -> JsonObject = { _, _ -> JsonObject(emptyMap()) },
) {
    val actor = ACTOR.get() ?: return
    val now = Clock.System.now()
    for (user in audienceOf(partyId) - actor) {
        notify(user, kind, now, subject, actor, payload.with(forUser(user, actor)))
    }
}

/**
 * The person whose Settlement card stands between [user] and [actor] over [partyId], in the party
 * owner's book: the card a sale lands on. A member settles with the owner, so a member hearing of
 * another member's sale is pointed at their own card with the owner.
 */
private fun cardOver(
    partyId: Uuid,
    user: String,
    actor: String,
): JsonObject {
    val owner =
        Party
            .select(Party.userId)
            .where { Party.id eq partyId }
            .firstOrNull()
            ?.get(Party.userId)
    val linked = if (user == owner) actor else user
    val person =
        owner?.let {
            Person
                .select(Person.id)
                .where { (Person.userId eq it) and (Person.linkedUserId eq linked) }
                .firstOrNull()
                ?.get(Person.id)
        }
    return buildJsonObject { person?.let { put("personId", it.toString()) } }
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
    forUser = { user, actor -> cardOver(partyId, user, actor) },
)
