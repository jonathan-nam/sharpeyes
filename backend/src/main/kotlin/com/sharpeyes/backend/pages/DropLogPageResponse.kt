package com.sharpeyes.backend.pages

import com.sharpeyes.backend.bosses.BossDropResponse
import com.sharpeyes.backend.bosses.BossResponse
import com.sharpeyes.backend.characters.CharacterResponse
import com.sharpeyes.backend.parties.PartyLootPoolResponse
import com.sharpeyes.backend.parties.PartyResponse
import com.sharpeyes.backend.parties.PersonResponse
import com.sharpeyes.backend.parties.ProceedsDisposalResponse
import com.sharpeyes.backend.parties.SettlementDebtResponse
import com.sharpeyes.backend.parties.VestigePaymentResponse
import com.sharpeyes.backend.parties.VestigeSettlementResponse
import com.sharpeyes.backend.parties.VestigeTrancheResponse
import kotlinx.serialization.Serializable

/**
 * Everything the Drop Log draws, in one response.
 *
 * The page needs eleven separate reads and used to make eleven requests for them. That is not a
 * round trip problem, since prod serves HTTP/2 and they go out together for about the cost of one.
 * It is CPU, which is the resource the box has least of: measured under load on the 2-vCPU prod
 * box, postgres sat at 4% while nginx, the two JVMs and auth together reached 133% of the 200%
 * available, and individual queries measured 0.6-2ms. The database was never the constraint.
 *
 * Eleven requests meant eleven JWT verifications, `ensureUser` upserts, `inActiveWorld` lookups,
 * transactions and JSON payloads, for one screen. Measured against the eleven summed on the same
 * data: 13.2ms of server time against 40.6ms.
 *
 * Every field is the type its own endpoint already returns, and the route fills them by calling the
 * same functions those endpoints call, so there is no second implementation to drift. A rename here
 * deserialises as an absent list on the client rather than an error, so the field names get a guard
 * on the frontend side once a page reads this.
 *
 * The response is big and that is not the problem, which is worth writing down because it looks
 * like it should be. Measured against the dev copy of real data: 190kb of JSON, of which `pools` is
 * 55% and `parties` 29%, gzipping to 25kb (13%) in about 3ms. Serialising it costs 3-5ms warm. So
 * the whole payload is maybe 25-35ms of an endpoint that measures 261-399ms in prod, and the rest
 * is the queries. Slimming it, or splitting the catalog out to be cached client-side (`drops` is
 * 7%), buys single-digit milliseconds for real coupling. Do not start there.
 */
@Serializable
data class DropLogPageResponse(
    val parties: List<PartyResponse>,
    val pools: List<PartyLootPoolResponse>,
    val tranches: List<VestigeTrancheResponse>,
    val payments: List<VestigePaymentResponse>,
    val settlements: List<VestigeSettlementResponse>,
    val debts: List<SettlementDebtResponse>,
    val disposals: List<ProceedsDisposalResponse>,
    val bosses: List<BossResponse>,
    val drops: Map<String, List<BossDropResponse>>,
    val characters: List<CharacterResponse>,
    val people: List<PersonResponse>,
)
