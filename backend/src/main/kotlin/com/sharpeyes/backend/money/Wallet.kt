package com.sharpeyes.backend.money

import kotlinx.serialization.Serializable

// What every pool adds up to: who you still owe, and who still owes you. The port of
// frontend/lib/wallet.ts. Not a second splitter: every meso is splitOf's.

fun isMine(member: PartyMember): Boolean = member.characterId != null

@Serializable
data class WalletLine(
    val partyId: String,
    val lootId: String,
    val name: String,
    val iconUrl: String? = null,
    val bossKey: String? = null,
    val droppedOn: String,
    val weekStart: String,
    /** owe or owed. */
    val direction: String,
    val bought: Boolean,
    val mine: String,
    val theirs: String,
    val theirsId: String,
    val payeeId: String,
    val pay: Double,
    val nets: Double,
    val currency: String,
)

@Serializable
data class Owings(
    val owe: Double = 0.0,
    val owed: Double = 0.0,
    val net: Double = 0.0,
)

@Serializable
data class Counterparty(
    val key: String,
    val name: String,
    val attributed: Boolean,
    val owe: Double,
    val owed: Double,
    val net: Double,
    val usd: Owings,
    val lines: List<WalletLine>,
)

@Serializable
data class Wallet(
    val counterparties: List<Counterparty>,
    val owe: Double,
    val owed: Double,
    val net: Double,
    val usd: Owings,
    val unreadable: Double,
    val betweenOthers: Double,
    val betweenMine: Double,
)

/** One counterparty while the pools are read: running totals in each unit, and the lines behind them. */
private class Group(
    val key: String,
    val name: String,
    val attributed: Boolean,
) {
    private val mesos = DoubleArray(2)
    private val cents = DoubleArray(2)
    val lines = mutableListOf<WalletLine>()

    fun add(line: WalletLine) {
        val side = if (line.currency == "USD") cents else mesos
        side[if (line.direction == "owe") OWE else OWED] += line.pay
        lines += line
    }

    fun toCounterparty() =
        Counterparty(
            key = key,
            name = name,
            attributed = attributed,
            owe = mesos[OWE],
            owed = mesos[OWED],
            net = mesos[OWED] - mesos[OWE],
            usd = Owings(cents[OWE], cents[OWED], cents[OWED] - cents[OWE]),
            lines = lines,
        )

    private companion object {
        const val OWE = 0
        const val OWED = 1
    }
}

/** The pools read one sold drop at a time. */
private class WalletReader(
    parties: List<Party>,
) {
    private val partyById = parties.associateBy { it.id }
    val groups = LinkedHashMap<String, Group>()
    var unreadable = 0.0
    var betweenOthers = 0.0
    var betweenMine = 0.0

    fun read(pool: PartyLootPool) {
        val party = partyById[pool.partyId]
        pool.loot.filter { it.soldAt != null }.forEach { loot ->
            val split = party?.let { splitOf(loot, it.seats) }
            if (party == null || split == null) unreadable += 1 else readSplit(pool, party, loot, split)
        }
    }

    private fun readSplit(
        pool: PartyLootPool,
        party: Party,
        loot: Loot,
        split: LootSplit,
    ) {
        val byId = party.seats.associateBy { it.id }
        val seller = byId.getValue(split.seller.memberId)
        for (share in split.shares.filterNot { it.paid }) {
            val member = byId.getValue(share.memberId)
            val sellerMine = isMine(seller)
            when {
                sellerMine != isMine(member) -> addLine(pool, loot, split, share, seller, member)
                sellerMine -> betweenMine += 1
                else -> betweenOthers += 1
            }
        }
    }

    /** A share between one of yours and one of theirs: a line on their counterparty. */
    private fun addLine(
        pool: PartyLootPool,
        loot: Loot,
        split: LootSplit,
        share: Share,
        seller: PartyMember,
        member: PartyMember,
    ) {
        val sellerMine = isMine(seller)
        val theirs = if (sellerMine) member else seller
        val mine = if (sellerMine) seller else member
        val key =
            theirs.personId?.takeIf { it.isNotEmpty() }?.let { "person:$it" } ?: "character:${theirs.name.lowercase()}"
        val group = groups.getOrPut(key) { Group(key, theirs.personName ?: theirs.name, theirs.personId != null) }
        group.add(
            WalletLine(
                partyId = pool.partyId,
                lootId = loot.id,
                name = loot.name,
                iconUrl = loot.iconUrl,
                bossKey = loot.bossKey,
                droppedOn = loot.droppedOn,
                weekStart = loot.weekStart,
                direction = if (sellerMine) "owe" else "owed",
                bought = loot.amountBasis == "BOUGHT",
                mine = mine.name,
                theirs = theirs.name,
                theirsId = theirs.id,
                payeeId = member.id,
                pay = share.pay,
                nets = share.nets,
                currency = split.currency,
            ),
        )
    }
}

/** Largest total first, mesos then dollars, then by name. */
private fun byWhatIsOwed(
    a: Counterparty,
    b: Counterparty,
): Int =
    compareNumbers((b.owe + b.owed) - (a.owe + a.owed)).takeIf { it != 0 }
        ?: compareNumbers((b.usd.owe + b.usd.owed) - (a.usd.owe + a.usd.owed)).takeIf { it != 0 }
        ?: localeCompare(a.name, b.name)

fun buildWallet(
    parties: List<Party>,
    pools: List<PartyLootPool>,
): Wallet {
    val reader = WalletReader(parties)
    pools.forEach(reader::read)
    val counterparties =
        reader.groups.values
            .map { it.toCounterparty() }
            .sortedWith(::byWhatIsOwed)
    val owe = counterparties.fold(0.0) { sum, c -> sum + c.owe }
    val owed = counterparties.fold(0.0) { sum, c -> sum + c.owed }
    val usdOwe = counterparties.fold(0.0) { sum, c -> sum + c.usd.owe }
    val usdOwed = counterparties.fold(0.0) { sum, c -> sum + c.usd.owed }
    return Wallet(
        counterparties = counterparties,
        owe = owe,
        owed = owed,
        net = owed - owe,
        usd = Owings(usdOwe, usdOwed, usdOwed - usdOwe),
        unreadable = reader.unreadable,
        betweenOthers = reader.betweenOthers,
        betweenMine = reader.betweenMine,
    )
}
