package com.sharpeyes.backend.bosses

import com.sharpeyes.backend.db.BossCatalog
import com.sharpeyes.backend.db.BossDrop
import com.sharpeyes.backend.db.BossDropAmount
import com.sharpeyes.backend.db.DropCatalog
import kotlinx.serialization.Serializable
import org.jetbrains.exposed.v1.jdbc.selectAll

// What each boss can drop, seeded from catalog/drops.yaml. Mirrored by the frontend's
// types/drop.ts field-for-field.

@Serializable
data class BossDropResponse(
    val dropKey: String,
    val name: String,
    // Backend-relative, resolved by apiAssetUrl(). Null for a drop with no official art, which
    // the client draws as a blank slot rather than a broken image.
    val iconUrl: String?,
    // ALWAYS or HEROIC when every member gets their own copy, null when the party gets one. The
    // loot pool warns on it: a per-member drop split six ways pays everyone a sixth of what they
    // already hold, which is the pooling-what-cannot-be-pooled mistake this app has made before.
    val perMember: String?,
    // INTERACTIVE for the coupons that do not drop in Reboot. Null means everywhere.
    val worlds: String?,
    val quantity: Int,
    /**
     * Copies are interchangeable, so a pile of these is sold as one lot at a going rate.
     *
     * What lets the Drop Log file a sale against a queue of rows instead of on each row where it
     * sits. False for a drop with its own potential lines and its own price, where a queue could
     * only ever guess which copy went.
     */
    val fungible: Boolean = false,
    /**
     * The item cannot change hands, so it never sells and no settlement can move it.
     *
     * Divisibility is untouched: a stack of these still divides by count, and entitled against
     * looted is what says whose turn it is next. What it removes is the DEBT, since a member short
     * of their share cannot be handed the difference.
     */
    val untradeable: Boolean = false,
    /**
     * How many pieces this boss drops of it, keyed by WORLD and then by difficulty.
     *
     * Two keys because the count is genuinely per world, not a restatement of `perMember`: Chaos
     * Kalos gives 5 pieces to the whole party on Interactive and 2 to each member on Heroic. World
     * outermost because a caller knows which world it is asking about before it knows the mode.
     *
     * Only the difficulties that drop any are in here. An absent one means nothing to fill, which is
     * not the same as none: a pre-filled zero would be a claim the drop table does not make.
     *
     * A HEROIC figure is always a count PER PERSON. Reboot instances every piece it drops, so a drop
     * carrying one is `per_member` there and build.py refuses it otherwise. An Interactive figure is
     * the size of a POOL, and writing one to both worlds is what had a Heroic party dividing 180
     * coupons all six of them already held.
     */
    val pieces: Map<String, Map<String, Int>> = emptyMap(),
    /**
     * How many equal stacks those pieces fall in, keyed the same way.
     *
     * What a party actually picks up, so it is what makes a share ratio mean anything on screen:
     * two against one on Extreme Kalos is four stacks of thirty against two. Absent for a
     * difficulty nobody has counted the stacks for, which is not a claim that it falls in one.
     */
    val bundles: Map<String, Map<String, Int>> = emptyMap(),
)

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
                untradeable = row[DropCatalog.untradeable],
                pieces = piecesFor[row[BossCatalog.bossKey] to row[DropCatalog.dropKey]].orEmpty(),
                bundles = bundlesFor[row[BossCatalog.bossKey] to row[DropCatalog.dropKey]].orEmpty(),
            )
        }
}
