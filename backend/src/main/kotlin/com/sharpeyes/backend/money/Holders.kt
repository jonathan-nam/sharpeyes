package com.sharpeyes.backend.money

import kotlinx.serialization.Serializable

// Whose pile a coupon is in. A HOLDER is a person, not a character: seats fold to their holder before
// anything is counted, so a party of your own two characters owes nothing. The port of the holder half
// of frontend/lib/vestige-ledger.ts.

const val PERSON = "PERSON"
const val SELF = "SELF"
const val CHARACTER = "CHARACTER"

/** You, as a holder key. */
const val SELF_KEY = "self"

val SELF_HOLDER = Holder(SELF, null, null)

private const val PERSON_PREFIX = "person:"
private const val CHARACTER_PREFIX = "character:"

/** One holder in a party: who they are, and how many shares their seats add up to. */
@Serializable
data class FoldedSeat(
    val key: String,
    val holder: Holder,
    val name: String,
    val shares: Double,
)

/** One person a pile owes coupons to. */
@Serializable
data class PieceCreditor(
    val key: String,
    val holder: Holder,
    val name: String,
    val pieces: Double,
)

/** Who a seat belongs to. Your own characters are you, which `characterId` says. */
fun holderOf(seat: PartyMember): Holder =
    when {
        seat.personId != null -> Holder(PERSON, seat.personId, null)
        seat.characterId != null -> SELF_HOLDER
        else -> Holder(CHARACTER, null, seat.name.trim().lowercase())
    }

/** How a holder is matched, on either side of the wire. */
fun holderKey(holder: Holder): String =
    when (holder.kind) {
        PERSON -> "$PERSON_PREFIX${holder.personId}"
        SELF -> SELF_KEY
        else -> "$CHARACTER_PREFIX${holder.characterName}"
    }

/** holderKey() read back. */
fun holderFromKey(key: String): Holder =
    when {
        key == SELF_KEY -> SELF_HOLDER
        key.startsWith(PERSON_PREFIX) -> Holder(PERSON, key.removePrefix(PERSON_PREFIX), null)
        else -> Holder(CHARACTER, null, key.removePrefix(CHARACTER_PREFIX))
    }

/** What to call a holder. Yours are "you". */
fun holderName(seat: PartyMember): String =
    when {
        seat.personId != null -> seat.personName ?: seat.name
        seat.characterId != null -> "you"
        else -> seat.name
    }

/** A party's seats folded to the people behind them, in the order each first appears. */
fun foldSeats(seats: List<PartyMember>): List<FoldedSeat> {
    val folded = LinkedHashMap<String, FoldedSeat>()
    for (seat in seats) {
        val holder = holderOf(seat)
        val key = holderKey(holder)
        val seen = folded[key]
        folded[key] =
            seen?.copy(shares = seen.shares + seat.shares) ?: FoldedSeat(key, holder, holderName(seat), seat.shares)
    }
    return folded.values.toList()
}

/** How many of a piece drop are YOURS, out of what fell. */
fun yourShare(
    whole: Double,
    seats: List<PartyMember>,
): Double {
    val folded = foldSeats(seats)
    val entitled = entitlements(whole, folded.map { LedgerSeat(it.key, it.name, 0.0, it.shares) })
    return entitled[SELF_KEY] ?: 0.0
}

/** Whether stacks can be shared out so every holder ends on exactly their entitlement. */
fun dividesEvenly(
    bundles: Double,
    holders: List<FoldedSeat>,
): Boolean {
    val weight = holders.fold(0.0) { sum, h -> sum + h.shares }
    return weight > 0 && holders.all { (bundles * it.shares) % weight == 0.0 }
}

/** The seats that ran the week THIS drop fell in, on that week's shares. Falls back to the members. */
fun ranSeats(
    loot: Loot,
    party: Party,
): List<PartyMember> {
    val ran = party.seats.filter { it.id in loot.ranThatWeek }
    val shares = loot.sharesThatWeek ?: emptyMap()
    return ran.ifEmpty { party.members }.map { seat -> shares[seat.id]?.let { seat.copy(shares = it) } ?: seat }
}

/** Who a pile owes pieces to across its open drops. Biggest debt first, then by name. */
fun pieceCreditors(ledger: HolderLedger): List<PieceCreditor> {
    val out = LinkedHashMap<String, PieceCreditor>()
    for (transfer in ledger.drops.filterNot { it.closed }.flatMap { it.transfers }) {
        val seen = out[transfer.toId]
        out[transfer.toId] =
            seen?.copy(pieces = seen.pieces + transfer.pieces)
                ?: PieceCreditor(transfer.toId, holderFromKey(transfer.toId), transfer.to, transfer.pieces)
    }
    return out.values.sortedWith { a, b ->
        compareNumbers(b.pieces - a.pieces).takeIf { it != 0 } ?: localeCompare(a.name, b.name)
    }
}
