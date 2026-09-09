package com.sharpeyes.backend.pages

import com.sharpeyes.backend.bosses.BossClearsViewResponse
import com.sharpeyes.backend.bosses.BossDropResponse
import com.sharpeyes.backend.bosses.BossResponse
import com.sharpeyes.backend.characters.CharacterResponse
import com.sharpeyes.backend.parties.PartyLootPoolResponse
import com.sharpeyes.backend.parties.PartyResponse
import com.sharpeyes.backend.parties.PersonResponse
import com.sharpeyes.backend.parties.SeatedPartyResponse
import com.sharpeyes.backend.parties.VestigeSettlementResponse
import kotlinx.serialization.Serializable

/**
 * What Party View cannot draw without, in one response.
 *
 * Split from the rest on purpose, and the split is the interesting part. The page made nine
 * requests on load and SIX of them were `.catch(() => null)`, each with a comment saying what
 * degrades: losing the pools costs one row's coupon figure, losing people costs the roster
 * editor's suggestions, losing seated costs a section this account may not even have. That is
 * deliberate, and one request for all nine would trade it for latency, because any read failing
 * would fail the page.
 *
 * Per-field recovery inside one request does not work either: Postgres aborts a transaction on a
 * failed statement, so a `runCatching` around one read cannot leave the others usable.
 *
 * So two requests rather than one or nine. This one failing blanks the page, exactly as the party
 * list failing already did. [PartiesExtrasResponse] failing costs those features and never the page.
 *
 * Nothing calls these yet. The endpoints ship before the page that uses them, because the two
 * deploy on separate clocks: Vercel on merge and the box when deploy.sh runs, so a page asking for
 * these in the same commit would spend that gap on a 404.
 */
@Serializable
data class PartiesPageResponse(
    val parties: List<PartyResponse>,
    val bosses: List<BossResponse>,
    val characters: List<CharacterResponse>,
)

/**
 * The reads Party View is built to survive losing. See [PartiesPageResponse] for why they are
 * grouped rather than fetched one by one.
 *
 * They degrade together now, where before each could fail alone. That is the cost of the split:
 * six requests become one, and one failure takes all six features instead of one. None of them
 * blanks the page, which is the property the six comments were protecting.
 */
@Serializable
data class PartiesExtrasResponse(
    val clears: BossClearsViewResponse,
    val drops: Map<String, List<BossDropResponse>>,
    val people: List<PersonResponse>,
    val pools: List<PartyLootPoolResponse>,
    val settlements: List<VestigeSettlementResponse>,
    val seated: List<SeatedPartyResponse>,
)
