package com.sharpeyes.backend.notifications

import com.sharpeyes.api.loot.LootResponse
import com.sharpeyes.backend.bosses.bossCatalog
import com.sharpeyes.backend.events.ACTOR
import com.sharpeyes.backend.parties.audienceOf
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
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
