package com.sharpeyes.backend.parties

import org.slf4j.LoggerFactory
import kotlin.uuid.Uuid

private val closeLog = LoggerFactory.getLogger("Close")

/**
 * One line per closing press, with every pot it moved, so a figure a card shows afterwards can be
 * traced back to what was written. Signed in the owner's terms: `net` is what the press settled of
 * what the person owed the owner, negative where the owner owed.
 */
internal fun logClose(
    owner: String,
    person: Uuid?,
    act: CloseAct,
) {
    val owe = act.parts.sumOf { it.amount }
    val owed = act.received.sumOf { it.amount }
    val holding = act.holding ?: 0
    val heldByThem = act.heldByThem ?: 0
    closeLog.info(
        "CLOSE kind=${act.kind} owner=$owner person=$person by=${act.recordedBy ?: "owner"} " +
            "sharesOwed=$owed/${act.received.size} sharesOwe=$owe/${act.parts.size} " +
            "heldByThem=$heldByThem holding=$holding net=${owed + heldByThem - owe - holding}",
    )
}
