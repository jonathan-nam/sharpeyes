package com.sharpeyes.api.bosses

import kotlinx.serialization.Serializable

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
     * How many pieces this boss drops of it, keyed by WORLD and then by difficulty.
     *
     * Only the difficulties that drop any are in here. An absent one means nothing to fill, which is
     * not the same as none: a pre-filled zero would be a claim the drop table does not make.
     *
     * Only INTERACTIVE is seeded. Its figure is the size of a POOL, and Reboot instances every piece
     * it drops: writing one to both worlds had a Heroic party dividing 180 coupons all six of them
     * already held.
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
