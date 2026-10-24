package com.sharpeyes.money.shared

import com.sharpeyes.money.Holder
import com.sharpeyes.money.Party
import com.sharpeyes.money.PartyLootPool
import com.sharpeyes.money.PartyMember
import com.sharpeyes.money.SettlementDebt
import com.sharpeyes.money.SharedBook
import com.sharpeyes.money.VestigeSettlement
import com.sharpeyes.money.coupons.PERSON
import com.sharpeyes.money.coupons.SELF
import com.sharpeyes.money.coupons.SELF_HOLDER
import com.sharpeyes.money.coupons.holderKey

// Other owners' books read from your side, and the runs both books recorded. The port of
// frontend/lib/shared-history.ts and duplicate-runs.ts. Seats and holders are swapped; every figure
// is then worked out by the same code your own book goes through.

data class SharedHistory(
    val parties: List<Party>,
    val pools: List<PartyLootPool>,
    val settlements: List<VestigeSettlement>,
    val debts: List<SettlementDebt>,
    val names: Map<String, String>,
)

/** One book's swap: your seat becomes yours, the owner's becomes a person of yours. */
private class Swap(
    private val book: SharedBook,
) {
    val ownerId = book.ownerPersonId ?: "owner-of:${book.personId}"
    val owner = Holder(PERSON, ownerId, null)

    fun seat(m: PartyMember): PartyMember {
        val yours = m.linkedCharacterId ?: m.id
        return when {
            m.personId == book.personId -> m.copy(personId = null, personName = null, characterId = yours)
            m.characterId != null -> m.copy(characterId = null, personId = ownerId, personName = book.ownerName)
            else -> m
        }
    }

    fun holder(h: Holder): Holder =
        when {
            h.kind == SELF -> owner
            h.kind == PERSON && h.personId == book.personId -> SELF_HOLDER
            else -> h
        }

    fun party(party: Party): Party {
        val seats = party.seats.map(::seat)
        val character = seats.find { it.characterId != null }?.characterId ?: party.characterId
        return party.copy(characterId = character, members = party.members.map(::seat), seats = seats, yours = false)
    }
}

/** Swaps you and the owner in their book. */
fun fromYourSide(book: SharedBook): SharedHistory {
    val swap = Swap(book)
    return SharedHistory(
        parties = book.parties.map(swap::party),
        pools = book.pools,
        settlements = book.settlements.map { it.copy(holder = swap.holder(it.holder)) },
        debts = book.debts.map { it.copy(holder = swap.holder(it.holder)) },
        names = mapOf(holderKey(swap.owner) to book.ownerName),
    )
}

fun sharedHistory(books: List<SharedBook>): SharedHistory {
    val sides = books.map(::fromYourSide)
    val names = LinkedHashMap<String, String>()
    sides.forEach { names.putAll(it.names) }
    val parties = sides.flatMap { it.parties }
    val pools = sides.flatMap { it.pools }
    return SharedHistory(parties, pools, sides.flatMap { it.settlements }, sides.flatMap { it.debts }, names)
}

/** One party's character-and-boss keys: a character clears a boss once a week. */
private fun keysOf(party: Party): List<String> {
    val characters = listOf(party.characterId) + party.seats.map { it.characterId }
    return characters.filterNotNull().distinct().map { "$it|${party.bossKey}" }
}

/**
 * Drops in YOUR OWN parties that a shared party already records: a character of yours in both, same
 * boss, same week. Keyed by loot id, naming whose party has it. The owner's copy is the one that counts.
 */
fun loggedTwice(
    own: Pair<List<Party>, List<PartyLootPool>>,
    shared: SharedHistory,
    ownerOf: Map<String, String>,
): Map<String, String> {
    val sharedById = shared.parties.associateBy { it.id }
    val recorded = LinkedHashMap<String, LinkedHashMap<String, String>>()
    for (pool in shared.pools.filter { sharedById.containsKey(it.partyId) }) {
        val party = sharedById.getValue(pool.partyId)
        for (key in keysOf(party)) {
            val weeks = recorded.getOrPut(key) { LinkedHashMap() }
            for (loot in pool.loot) weeks[loot.weekStart] = ownerOf[party.id] ?: ""
        }
    }
    val ownById = own.first.associateBy { it.id }
    val twice = LinkedHashMap<String, String>()
    for (pool in own.second) {
        val weeks = ownById[pool.partyId]?.let { party -> keysOf(party).mapNotNull { recorded[it] } } ?: emptyList()
        for (loot in pool.loot) {
            val owner = weeks.firstOrNull { it.containsKey(loot.weekStart) }?.get(loot.weekStart)
            if (owner != null) twice[loot.id] = owner
        }
    }
    return twice
}

/** The pools with the named drops taken out. */
fun withoutLoot(
    pools: List<PartyLootPool>,
    drop: Map<String, String>,
): List<PartyLootPool> {
    if (drop.isEmpty()) return pools
    return pools.map { pool -> pool.copy(loot = pool.loot.filter { it.id !in drop }) }
}
