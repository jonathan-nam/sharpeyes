package com.sharpeyes.planning

/**
 * The best [k] items, in no particular order, with the single best one first. Works in place.
 *
 * The same SET as sorting and taking k, which is all the beam reads, given that [better] is a total
 * order. Hoare partition around a median-of-three pivot, as frontend/lib/boss-run-plan.ts bestOf.
 */
fun <T> bestOf(
    items: MutableList<T>,
    k: Int,
    better: (T, T) -> Int,
): MutableList<T> {
    if (k <= 0) return mutableListOf()
    if (items.size > k) {
        var lo = 0
        var hi = items.size - 1
        while (lo < hi) {
            val split = partition(items, lo, hi, better)
            // The cut sits at index k-1, so a partition landing at or past k means the pivot and
            // everything right of it are out.
            if (split >= k) hi = split - 1 else lo = split + 1
        }
        items.subList(k, items.size).clear()
    }
    // Partitioning only guarantees the set, so the leader is found rather than assumed.
    var leader = 0
    for (i in 1 until items.size) if (better(items[i], items[leader]) < 0) leader = i
    if (leader > 0) items.swap(0, leader)
    return items
}

/** Partitions [items] from [lo] to [hi] around a median-of-three pivot, returning where it lands. */
private fun <T> partition(
    items: MutableList<T>,
    lo: Int,
    hi: Int,
    better: (T, T) -> Int,
): Int {
    val mid = (lo + hi) shr 1
    if (better(items[mid], items[lo]) < 0) items.swap(mid, lo)
    if (better(items[hi], items[lo]) < 0) items.swap(hi, lo)
    if (better(items[mid], items[hi]) < 0) items.swap(mid, hi)
    val pivot = items[hi]
    var split = lo
    for (i in lo until hi) {
        if (better(items[i], pivot) < 0) items.swap(i, split++)
    }
    items.swap(split, hi)
    return split
}

internal fun <T> MutableList<T>.swap(
    a: Int,
    b: Int,
) {
    val held = this[a]
    this[a] = this[b]
    this[b] = held
}
