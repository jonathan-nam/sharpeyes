package com.sharpeyes.money

import com.sharpeyes.money.droplog.statusLabel
import com.sharpeyes.money.split.buildWallet
import com.sharpeyes.money.split.saleMoney
import com.sharpeyes.money.split.splitDrop
import com.sharpeyes.money.split.splitOf
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/** Every ported module's recorded calls, replayed. A module is listed once its port exists. */
class ModuleGoldenTest {
    private fun check(
        module: String,
        adapters: Map<String, Adapter>,
    ) {
        val calls = moduleCalls(module)
        assertTrue(calls.isNotEmpty(), "no $module fixture")
        val wrong = disagreements(calls, adapters)
        assertEquals(
            emptyList(),
            wrong.take(SHOWN),
            "$module: ${wrong.size} disagreements over ${calls.values.sumOf { it.size }} calls",
        )
    }

    @Test
    fun `piece-ledger`() = check("piece-ledger", pieceLedgerAdapters)

    @Test
    fun `drop-split`() = check("drop-split", mapOf("drop-split.splitDrop" to { a -> out(splitDrop(a.arg(0))) }))

    @Test
    fun loot() =
        check(
            "loot",
            mapOf(
                "loot.saleMoney" to { a -> out(saleMoney(a.arg<Loot>(0))) },
                "loot.splitOf" to { a -> out(splitOf(a.arg(0), a.arg(1))) },
                "loot.statusLabel" to { a -> out(statusLabel(a.arg(0))) },
            ),
        )

    @Test
    fun wallet() =
        check(
            "wallet",
            vestigeHelperAdapters + ("wallet.buildWallet" to { a -> out(buildWallet(a.arg(0), a.arg(1))) }),
        )

    @Test
    fun `vestige-ledger`() = check("vestige-ledger", vestigeAdapters + vestigeHelperAdapters)

    @Test
    fun `ledger-fates`() = check("ledger-fates", ledgerFatesAdapters + vestigeHelperAdapters)

    @Test
    fun settlement() = check("settlement", settlementAdapters + settlementCardAdapters)

    private companion object {
        const val SHOWN = 5
    }
}
