package com.sharpeyes.backend.parties

import com.sharpeyes.backend.db.PartyLoot
import com.sharpeyes.backend.events.Topic
import com.sharpeyes.backend.events.publishToParty
import org.jetbrains.exposed.v1.core.eq
import org.jetbrains.exposed.v1.jdbc.selectAll
import kotlin.uuid.Uuid

// A pool's writers tell the party here (events/). Inside the writer's transaction, so it is heard on
// commit and never for a write that rolled back.

/** Tells everybody in the party that its pool moved, so their Drop Log reads it again. */
internal fun poolChanged(partyId: Uuid) = publishToParty(partyId, Topic.LOOT)

/** The same, for a write that knows the drop and not its party. */
internal fun poolOfLootChanged(lootId: Uuid) {
    PartyLoot
        .selectAll()
        .where { PartyLoot.id eq lootId }
        .firstOrNull()
        ?.let { poolChanged(it[PartyLoot.partyId]) }
}
