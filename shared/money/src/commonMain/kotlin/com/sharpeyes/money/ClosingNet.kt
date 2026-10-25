package com.sharpeyes.money

import kotlinx.serialization.Serializable
import kotlin.math.abs

// What one closing act settles on a Settlement card, netted, and who pays. The port of closingNet
// and flipNet in frontend/lib/settlement.ts, where the rules are written down.

/** YOU, THEM, or null when the pair is even. */
private const val YOU = "YOU"
private const val THEM = "THEM"

/** One share a closing act settles. Its unit says whether an Offset can take it (mesos only). */
@Serializable
data class ClosingShare(
    val lootId: String,
    val memberId: String,
    val amount: Double,
    val currency: String,
)

@Serializable
data class ClosingNet(
    val mesos: Double,
    val payer: String?,
    val sharesYouOwe: List<ClosingShare>,
    val sharesTheyOwe: List<ClosingShare>,
    val holding: Double,
    val heldByThem: Double,
    val usdYouOwe: Double,
    val usdTheyOwe: Double,
    val enteredBalance: Double,
    val open: Boolean,
)

private fun sharesRunning(
    row: Settlement,
    direction: String,
): List<ClosingShare> =
    row.lines
        .filter { it.direction == direction }
        .map { ClosingShare(it.lootId, it.payeeId, it.pay, it.currency) }

private fun inCurrency(
    row: Settlement,
    direction: String,
    currency: String,
): Double =
    row.lines
        .filter { it.direction == direction && it.currency == currency }
        .fold(0.0) { sum, line -> sum + line.pay }

/** What one closing act settles on this card, and which way the mesos go. */
fun closingNet(row: Settlement): ClosingNet {
    val signed = inCurrency(row, "owe", "MESO") + row.holding - row.heldByThem - inCurrency(row, "owed", "MESO")
    val sharesYouOwe = sharesRunning(row, "owe")
    val sharesTheyOwe = sharesRunning(row, "owed")
    val payer =
        when {
            signed > 0 -> YOU
            signed < 0 -> THEM
            else -> null
        }
    return ClosingNet(
        mesos = abs(signed),
        payer = payer,
        sharesYouOwe = sharesYouOwe,
        sharesTheyOwe = sharesTheyOwe,
        holding = row.holding,
        heldByThem = row.heldByThem,
        usdYouOwe = inCurrency(row, "owe", "USD"),
        usdTheyOwe = inCurrency(row, "owed", "USD"),
        enteredBalance = row.parts.sum() - row.parts.shares,
        open = sharesYouOwe.isNotEmpty() || sharesTheyOwe.isNotEmpty() || row.holding > 0 || row.heldByThem > 0,
    )
}

/** [net] read from the other end: what the member's card draws from the owner's row. */
fun flipNet(net: ClosingNet): ClosingNet {
    val payer =
        when (net.payer) {
            YOU -> THEM
            THEM -> YOU
            else -> null
        }
    return ClosingNet(
        mesos = net.mesos,
        payer = payer,
        sharesYouOwe = net.sharesTheyOwe,
        sharesTheyOwe = net.sharesYouOwe,
        holding = net.heldByThem,
        heldByThem = net.holding,
        usdYouOwe = net.usdTheyOwe,
        usdTheyOwe = net.usdYouOwe,
        enteredBalance = -net.enteredBalance,
        open = net.open,
    )
}
