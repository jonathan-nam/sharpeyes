package com.sharpeyes.backend.bosses

import com.sharpeyes.api.bosses.BossDropResponse
import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.BossDrop
import com.sharpeyes.backend.db.BossDropAmount
import com.sharpeyes.backend.db.DropCatalog
import org.jetbrains.exposed.v1.jdbc.selectAll

// What each boss can drop, seeded from catalog/drops.yaml. Mirrored by the frontend's
// types/drop.ts field-for-field.

/**
 * Every boss's drop table, keyed by boss key.
 *
 * One query for the lot rather than one per boss: the whole catalog is a few dozen rows, and the
 * client needs the table for whichever boss the user picks next. Must run inside a transaction.
 */
@Volatile
private var heldDropTables: Map<String, List<BossDropResponse>>? = null

/**
 * Held for the life of the process, for the reason bossCatalog is: same rows for every account, and
 * `R__drop_catalog.sql` is a repeatable migration, so a change to them arrives as a deploy.
 */
internal fun dropTables(): Map<String, List<BossDropResponse>> =
    heldDropTables ?: readDropTables().also { heldDropTables = it }

private fun readDropTables(): Map<String, List<BossDropResponse>> {
    // One query for every amount, keyed the way the rows below need it. A join would multiply each
    // drop by its difficulties and the group-by would count one drop several times.
    val amounts =
        BossDropAmount
            .innerJoin(BossCatalog)
            .innerJoin(DropCatalog)
            .selectAll()
            .groupBy({ it[BossCatalog.bossKey] to it[DropCatalog.dropKey] }) { it }
    val piecesFor =
        amounts.mapValues { (_, rows) ->
            rows.groupBy { it[BossDropAmount.world] }.mapValues { (_, inWorld) ->
                inWorld.associate { it[BossDropAmount.difficulty] to it[BossDropAmount.pieces] }
            }
        }
    // Only the difficulties whose stacks have been counted, so an uncounted one is absent rather
    // than present as one stack. A world left with nothing counted drops out entirely, for the same
    // reason: an empty map there would read as a world whose stacks are known and are none.
    val bundlesFor =
        amounts.mapValues { (_, rows) ->
            rows
                .groupBy { it[BossDropAmount.world] }
                .mapValues { (_, inWorld) ->
                    inWorld
                        .mapNotNull { row ->
                            row[BossDropAmount.bundles]?.let { row[BossDropAmount.difficulty] to it }
                        }.toMap()
                }.filterValues { it.isNotEmpty() }
        }

    return BossDrop
        .innerJoin(BossCatalog)
        .innerJoin(DropCatalog)
        .selectAll()
        .orderBy(BossCatalog.sortOrder to org.jetbrains.exposed.v1.core.SortOrder.ASC)
        .orderBy(BossDrop.sortOrder to org.jetbrains.exposed.v1.core.SortOrder.ASC)
        .groupBy({ it[BossCatalog.bossKey] }) { row ->
            BossDropResponse(
                dropKey = row[DropCatalog.dropKey],
                name = row[DropCatalog.name],
                iconUrl = row[DropCatalog.iconRefKey]?.let { "/drop-icons/$it" },
                perMember = row[DropCatalog.perMember],
                worlds = row[DropCatalog.worlds],
                quantity = row[DropCatalog.quantity],
                fungible = row[DropCatalog.fungible],
                pieces = piecesFor[row[BossCatalog.bossKey] to row[DropCatalog.dropKey]].orEmpty(),
                bundles = bundlesFor[row[BossCatalog.bossKey] to row[DropCatalog.dropKey]].orEmpty(),
            )
        }
}
