package com.sharpeyes.backend.money

import kotlinx.serialization.Serializable

// Everything the Drop Log's Settlement stage draws, off one account's two payloads: its own page and
// the books other owners keep with it. The composition app/bosses/drops/page.tsx runs today, and what
// the backend serves in its place (docs/backend-arithmetic-plan.md, Phase 3).

@Serializable
data class DropLogFigures(
    /** Drops of yours a shared party already records, by loot id, naming whose party has it. */
    @Serializable(with = TaggedMapSerializer::class)
    val twice: Map<String, String>,
    val view: SettlementView,
    /** One per book, in order; null where the book says nothing about you. */
    val sharedCards: List<SharedCard?>,
    val sharedPiles: List<SharedPile?>,
)

fun dropLogFigures(
    page: DropLogPage,
    books: List<SharedBook>,
): DropLogFigures {
    val shared = sharedHistory(books)
    val ownerOf = LinkedHashMap<String, String>()
    for (book in books) book.parties.forEach { ownerOf[it.id] = book.ownerName }
    val twice = loggedTwice(page.parties to page.pools, shared, ownerOf)
    // A run in both your party and theirs counts once, as the owner's copy.
    val view = settlementView(page.copy(pools = withoutLoot(page.pools, twice)))
    return DropLogFigures(
        twice,
        view,
        books.map { sharedCard(it, page.bosses) },
        books.map { sharedPile(it, page.bosses) },
    )
}
