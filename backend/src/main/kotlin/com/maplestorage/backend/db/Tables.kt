package com.maplestorage.backend.db

import com.maplestorage.backend.sprites.SPRITE_KEY_LENGTH
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import org.jetbrains.exposed.v1.core.Table
import org.jetbrains.exposed.v1.datetime.date
import org.jetbrains.exposed.v1.datetime.timestamp
import org.jetbrains.exposed.v1.json.jsonb

// Column definitions mirror db/migration/V1__create_core_schema.sql column-for-column.
// Flyway owns the actual DDL (see that file); these Table objects exist purely so
// route/repository code gets compile-time-checked query building instead of raw SQL
// string literals. There is no SchemaUtils.create(...) call anywhere.

object Users : Table("users") {
    // The auth service's user id, a string and not a UUID. Arrives as the JWT's `sub`, so this is
    // the one column whose values another service chooses.
    val id = text("id")
    val email = text("email")
    val createdAt = timestamp("created_at")

    // INTERACTIVE or HEROIC (V26). The account-wide answer, used where there is no character to
    // ask: what the section menu offers, and what a newly added character inherits.
    val worldType = text("world_type")

    // The character drawn as the account avatar (V65), or null for none.
    //
    // A plain uuid, NOT reference(Characters.id). Characters already references Users, and Exposed
    // half-builds the object on a cycle: unrelated queries stop matching and nothing is thrown.
    // The foreign key and its ON DELETE SET NULL are declared in V65 instead.
    val mainCharacterId = uuid("main_character_id").nullable()

    override val primaryKey = PrimaryKey(id)
}

object Characters : Table("characters") {
    val id = uuid("id")
    val userId = reference("user_id", Users.id)
    val name = text("name")
    val level = integer("level").nullable()
    val jobName = text("job_name").nullable()
    val worldName = text("world_name").nullable()

    // INTERACTIVE or HEROIC (V26), and the one every party reads: a party hangs off a character,
    // so this decides whether that party's loot can be sold at all. Not derived from worldName,
    // which nothing populates.
    val worldType = text("world_type")
    val spriteImgUrl = text("sprite_img_url").nullable()

    // When the lookup last ANSWERED, and when it was last asked. Both, because a name that has
    // stopped ranking leaves the first alone and the daily refresh has to select on the second or it
    // re-asks the same dead names every tick. See V53.
    val spriteRefreshedAt = timestamp("sprite_refreshed_at").nullable()
    val spriteCheckedAt = timestamp("sprite_checked_at").nullable()
    val createdAt = timestamp("created_at")
    val updatedAt = timestamp("updated_at")

    // The user's chosen order in the carousel, 0-based and dense per user (V11). Reads sort by it.
    val position = integer("position")

    override val primaryKey = PrimaryKey(id)
}

object TokenCatalog : Table("token_catalog") {
    // No auto-default. Rows are seeded by R__token_catalog.sql (generated from
    // catalog/items.yaml), which keeps an existing row's id across re-seeds, these ids are
    // referenced by character_token_count, so churning them would orphan every user's counts.
    val id = uuid("id")
    val name = text("name").uniqueIndex()

    // The key the screenshot parser identifies this token by (it is the name of
    // the template file in vision/app/cv/templates/). Deliberately separate from
    // `name`: that is prose for humans and can be reworded, this is an
    // identifier and must not change without renaming the template too.
    val visionKey = text("vision_key").uniqueIndex()

    val sourceBossName = text("source_boss_name").nullable()

    val iconRefKey = text("icon_ref_key").nullable()

    // Which section of the inventory a human expects to find this in ("Eternal Pieces",
    // "Symbols", "Consumables"). A different axis from redemption: that says what an item DOES,
    // this says where it LIVES. Symbols and elixirs are both consumables and nobody looks for
    // them in the same place. Seeded from catalog/items.yaml (V8, R__token_catalog.sql).
    val itemGroup = text("item_group").nullable()

    // Where this item sits within its section. Alphabetical is wrong for the symbols and wrongly
    // enough to confuse: they follow the AREAS' progression (Vanishing Journey -> Esfera, then
    // Cernium -> Tallahart), which is the order a player unlocks them in and the order the game's
    // own Symbol UI uses. Sorting by name interleaves the two rivers and puts Arcana first.
    val sortOrder = integer("sort_order").nullable()

    override val primaryKey = PrimaryKey(id)
}

// Items you collect N of and trade in. No row means the item is simply counted, which is
// most of them, and all of the consumables. "Is this redeemable?" is therefore not a flag that
// can drift out of step with the fields it governs; it is whether a rule exists (V7).
object RedemptionRule : Table("redemption_rule") {
    val itemId = reference("item_id", TokenCatalog.id)
    val redeemThreshold = integer("redeem_threshold")

    // What the token BUYS. The two sets do not overlap: Kalos / Kaling / First Adversary /
    // Malefic Star pieces make a Hat, Top, Bottom or Shoulder; Limbo and Baldrix pieces make a
    // Cape, Glove or Shoe. So ten of one plus ten of the other is not twenty pieces, it is one
    // armour and one accessory, and a UI that adds them is lying.
    val slotGroup = array<String>("slot_group")
    val bonusItemName = text("bonus_item_name").nullable()

    override val primaryKey = PrimaryKey(itemId)
}

object Screenshots : Table("screenshots") {
    val id = uuid("id")
    val userId = reference("user_id", Users.id)
    val characterId = optReference("character_id", Characters.id)

    // Nullable since V3: a FAILED row (the vision service was unreachable) never
    // got classified, so it has no type. Images are parsed in memory and
    // discarded, never persisted. Hence no storage_key column.
    val type = text("type").nullable()
    val uploadedAt = timestamp("uploaded_at")
    val parseStatus = text("parse_status").default("PENDING")

    // The parser's own output: grid coords, template match scores, digit reads.
    // Not a model response, and has not been one since the OpenCV rewrite (V5).
    val rawParseResult = jsonb<JsonElement>("raw_parse_result", Json).nullable()
    val detectedCharacterName = text("detected_character_name").nullable()
    val detectedLevel = integer("detected_level").nullable()

    override val primaryKey = PrimaryKey(id)
}

object CharacterTokenCount : Table("character_token_count") {
    // Composite PK directly gives the "unique per character+token" constraint
    // and matches the latest-snapshot upsert access pattern
    // (INSERT ... ON CONFLICT (character_id, token_catalog_id) DO UPDATE).
    val characterId = reference("character_id", Characters.id)
    val tokenCatalogId = reference("token_catalog_id", TokenCatalog.id)
    val quantity = integer("quantity")
    val capturedAt = timestamp("captured_at")
    val sourceScreenshotId = optReference("source_screenshot_id", Screenshots.id)

    override val primaryKey = PrimaryKey(characterId, tokenCatalogId)
}

object BossCatalog : Table("boss_catalog") {
    // No auto-default, seeded by R__boss_catalog.sql (generated from catalog/bosses.yaml),
    // which keeps an existing row's id across re-seeds since boss_clear references it.
    val id = uuid("id")
    val bossKey = text("boss_key").uniqueIndex()
    val name = text("name")
    val reset = text("reset")

    // Manifest position, so the matrix draws its columns in progression order rather than
    // alphabetically. See V12__boss_sort_order.sql.
    val sortOrder = integer("sort_order").nullable()

    // The boss's planner portrait under seed-assets/bosses, served at /boss-icons. Cut from a real
    // capture (vision/app/cv/build_boss_portraits.py), so it is the art the game itself shows.
    val iconRefKey = text("icon_ref_key").nullable()

    // The modes this boss can be fought at, lowest first, and the only ones a config may pick.
    // Seeded from catalog/bosses.yaml. See V24__party_difficulty.sql.
    val difficulties = array<String>("difficulties")
}

object BossClear : Table("boss_clear") {
    // Composite PK gives "unique per character+boss+period" and matches the latest-capture
    // upsert access pattern (INSERT ... ON CONFLICT (character_id, boss_catalog_id,
    // period_start) DO UPDATE). Rows with cleared=false are the character's routine for the
    // period, so pending bosses are known, not just clears.
    val characterId = reference("character_id", Characters.id)
    val bossCatalogId = reference("boss_catalog_id", BossCatalog.id)
    val periodStart = date("period_start")
    val cleared = bool("cleared")
    val capturedAt = timestamp("captured_at")
    val sourceScreenshotId = optReference("source_screenshot_id", Screenshots.id)

    override val primaryKey = PrimaryKey(characterId, bossCatalogId, periodStart)
}

// Bosses a character does not run, so an empty cell can say which kind of empty it is. A standing
// fact with no period: see V25__character_boss_skip.sql for why it is an exclusion list and why it
// is never inferred from a capture.
object CharacterBossSkip : Table("character_boss_skip") {
    val characterId = reference("character_id", Characters.id)
    val bossCatalogId = reference("boss_catalog_id", BossCatalog.id)
    val createdAt = timestamp("created_at")

    override val primaryKey = PrimaryKey(characterId, bossCatalogId)
}

// One of YOUR characters, on one boss, with the people that character runs it with. A roster only:
// what was actually killed stays in BossClear, which comes from a planner capture.
// See V16__party.sql and V22__party_config.sql.
object Party : Table("party") {
    val id = uuid("id")
    val userId = reference("user_id", Users.id)

    // Whose config this is, and for which boss. One config per pair: two would be two answers to
    // "what does this character run this boss with".
    val characterId = reference("character_id", Characters.id)
    val bossCatalogId = reference("boss_catalog_id", BossCatalog.id)

    // Which mode this party runs, one of the boss's own difficulties. Null is not a default of
    // NORMAL, it is nobody having said yet.
    val difficulty = text("difficulty").nullable()

    // How long this party takes on this boss, door to door. Null is not the default estimate, it
    // is nobody having timed it. See V28__party_minutes.sql for why it is not a property of the
    // boss.
    val minutes = integer("minutes").nullable()

    // The seat that picks up the pieces for this party, when one member loots the lot. Not always
    // one of yours: a duo where the partner loots and sells is the easier arrangement on a boss run
    // with a character that is not on your account. Null is everybody looting their own.
    // See V36__party_looter.sql.
    //
    // A plain column and NOT optReference(PartyMember.id), which would be a circular initialisation:
    // PartyMember references Party.id, so each object would need the other finished first. Exposed
    // does not fail on it, it half-builds one of the two and queries against Party then quietly stop
    // matching. The foreign key is real, declared in the migration; only this mirror leaves it out.
    val looterMemberId = uuid("looter_member_id").nullable()

    // One seat, because nobody else was there. It owns a pool like any other config and is listed
    // as a party nowhere. See V30__party_solo.sql.
    val solo = bool("solo")

    // On for one period rather than every one, so a boss run once is gone next Thursday without
    // being told to. It inverts which of the two exception tables applies. See V32__party_one_off.sql.
    val oneOff = bool("one_off")

    // Still run, so still listed. False is a config taken off the lists whose pool is kept, which
    // is what deleting one that has ever held a drop does instead. Same word as PartyMember's, for
    // the same reason. See V33__party_standing.sql.
    val standing = bool("standing")

    val createdAt = timestamp("created_at")
    val updatedAt = timestamp("updated_at")

    override val primaryKey = PrimaryKey(id)
}

// The periods a party is not running its boss, the config left standing. No rows for a period means
// it runs as usual, so putting it back is a deletion. Filed by the boss's own cadence like a clear,
// not by Thursday weeks like a roster. See V31__party_period_skip.sql.
object PartyPeriodSkip : Table("party_period_skip") {
    val partyId = reference("party_id", Party.id)
    val periodStart = date("period_start")
    val createdAt = timestamp("created_at")

    override val primaryKey = PrimaryKey(partyId, periodStart)
}

// The twin of the above, for a one-off config: the periods it DID run. Off in every period this
// does not name, so next period drops it with nobody saying so. See V32__party_one_off.sql.
object PartyPeriodRun : Table("party_period_run") {
    val partyId = reference("party_id", Party.id)
    val periodStart = date("period_start")
    val createdAt = timestamp("created_at")

    override val primaryKey = PrimaryKey(partyId, periodStart)
}

// The people you run with. See V21__person.sql.
object Person : Table("person") {
    val id = uuid("id")
    val userId = reference("user_id", Users.id)
    val name = text("name")

    // Keep their Settlement Ledger card drawn with nothing outstanding. Set by hand, derived from
    // nothing. See V59__person_pinned.sql.
    val pinned = bool("pinned")
    val createdAt = timestamp("created_at")
    val updatedAt = timestamp("updated_at")

    override val primaryKey = PrimaryKey(id)
}

// Which characters somebody else plays. An account-wide fact, stated once: CreedBratton is Chris's
// wherever that name turns up, rather than once per seat.
object PersonCharacter : Table("person_character") {
    val id = uuid("id")
    val personId = reference("person_id", Person.id)
    val userId = reference("user_id", Users.id)
    val name = text("name")

    override val primaryKey = PrimaryKey(id)
}

object PartyMember : Table("party_member") {
    val id = uuid("id")
    val partyId = reference("party_id", Party.id)
    val name = text("name")

    // Set when the seat is one of the caller's own characters. Optional, and SET NULL on delete,
    // so removing a character leaves the seat (and any loot split with it) readable.
    val characterId = optReference("character_id", Characters.id)

    val position = integer("position")

    // Only for seats that are NOT one of this account's characters: those read their sprite off
    // Characters, which is kept refreshed. See V20__party_member_sprite.sql.
    val spriteImgUrl = text("sprite_img_url").nullable()
    val spriteRefreshedAt = timestamp("sprite_refreshed_at").nullable()

    // In the party's usual roster. False is a guest, or somebody who has left it: either way the
    // seat stays, because payouts and past weeks point at it. See V27__party_week_roster.sql.
    val standing = bool("standing")

    // What this seat usually takes of a split, 1 unless somebody carries. A sale copies it as its
    // default and pins its own, so editing this cannot rewrite a settled night.
    val shares = integer("shares")

    override val primaryKey = PrimaryKey(id)
}

// The seats that ran in one week, when that week was not the usual roster. No rows for a week
// means the standing roster, so reverting is a delete. See V27__party_week_roster.sql.
object PartyWeekSeat : Table("party_week_seat") {
    val partyId = reference("party_id", Party.id)
    val weekStart = date("week_start")
    val memberId = reference("member_id", PartyMember.id)

    // This seat's share in THIS week. Null is the standing party_member.shares, which is what every
    // row written before V55 holds and what most weeks will always hold. See V55__party_week_shares.
    val shares = integer("shares").nullable()

    override val primaryKey = PrimaryKey(partyId, weekStart, memberId)
}

// What a boss can drop, and the art shown beside it. Seeded by R__drop_catalog.sql from
// catalog/drops.yaml. Separate from TokenCatalog, which is what the parser counts in an
// inventory. See V17__drop_catalog.sql.
object DropCatalog : Table("drop_catalog") {
    // No auto-default: the seed keeps an existing row's id, which PartyLoot references.
    val id = uuid("id")
    val dropKey = text("drop_key").uniqueIndex()
    val name = text("name")

    // The file under seed-assets/drops, served at /drop-icons. Null when the pinned dataset has
    // no art for it, so the client knows to draw the row without an icon.
    val iconRefKey = text("icon_ref_key").nullable()

    // ALWAYS or HEROIC when every member gets their own copy, null when the party gets one. It
    // decides whether a drop is poolable at all, so it is data, not a label.
    val perMember = text("per_member").nullable()
    val worlds = text("worlds").nullable()
    val quantity = integer("quantity")

    // Copies are interchangeable, so these sell as a lot and a sale is filed against a queue of
    // rows rather than on the row where it sits. See V45__drop_fungible.sql.
    val fungible = bool("fungible")

    // The item cannot change hands, so it never sells and settles only by who looted it. Not the
    // same fact as a world that cannot trade. See V62__drop_untradeable.sql.
    val untradeable = bool("untradeable")
    val sortOrder = integer("sort_order")

    override val primaryKey = PrimaryKey(id)
}

object BossDrop : Table("boss_drop") {
    val bossCatalogId = reference("boss_catalog_id", BossCatalog.id)
    val dropCatalogId = reference("drop_catalog_id", DropCatalog.id)
    val sortOrder = integer("sort_order")

    override val primaryKey = PrimaryKey(bossCatalogId, dropCatalogId)
}

// How many pieces one boss drops at one difficulty. Only the combinations that drop any have a row,
// so an absent one means nothing to fill rather than none. See V35__boss_drop_amount.sql.
object BossDropAmount : Table("boss_drop_amount") {
    val bossCatalogId = reference("boss_catalog_id", BossCatalog.id)
    val dropCatalogId = reference("drop_catalog_id", DropCatalog.id)
    val difficulty = text("difficulty")

    // INTERACTIVE or HEROIC. A second, independent number per world, not a restatement of
    // per_member. See V63__boss_drop_amount_world.sql.
    val world = text("world")
    val pieces = integer("pieces")

    // How many equal whole stacks those pieces fall in, which is what a party actually picks up.
    // Null is uncounted, NOT one stack. See V41__loot_bundles.sql.
    val bundles = integer("bundles").nullable()

    override val primaryKey = PrimaryKey(bossCatalogId, dropCatalogId, difficulty, world)
}

// A party's loot pool. Stores what was entered, never what was computed: the split arithmetic
// lives in frontend/lib/drop-split.ts and a second copy here would be a second answer.
object PartyLoot : Table("party_loot") {
    val id = uuid("id")
    val partyId = reference("party_id", Party.id)

    // Exactly one of these is set (party_loot_named_once).
    val dropCatalogId = optReference("drop_catalog_id", DropCatalog.id)
    val customName = text("custom_name").nullable()

    val bossCatalogId = optReference("boss_catalog_id", BossCatalog.id)
    val droppedOn = date("dropped_on")

    // How many of it the row holds. 1 for a drop that is one item; a stack of coupons is one row
    // with the count on it. See V34__loot_quantity_and_shares.sql.
    val quantity = integer("quantity")

    // The app added this row from a clear rather than a human logging it, so un-ticking that clear
    // may take it back. See V37__loot_from_clear.sql.
    val fromClear = bool("from_clear")

    // The sale, all six columns or none of them (party_loot_sale_complete).
    val soldAt = timestamp("sold_at").nullable()
    val saleAmount = long("sale_amount").nullable()
    val amountBasis = text("amount_basis").nullable()
    val splitMethod = text("split_method").nullable()

    // The seller's own share count, pinned with the rest of the sale.
    val sellerShares = integer("seller_shares").nullable()

    // Whoever ended up holding the value and owing the rest: the seller, or on a BOUGHT basis the
    // member who bought it.
    val sellerMemberId = optReference("seller_member_id", PartyMember.id)

    // Who took the item, in a world where it cannot be sold. The Heroic axis of soldAt above, and
    // exclusive with it (party_loot_sold_or_taken). Nothing is owed: see V49.
    val takenByMemberId = optReference("taken_by_member_id", PartyMember.id)

    val createdAt = timestamp("created_at")
    val updatedAt = timestamp("updated_at")

    override val primaryKey = PrimaryKey(id)
}

// Who is owed for a sale, pinned at the moment it sold rather than re-derived from the party.
// See V18__party_loot.sql.
// One tranche of a looter's sales: pieces, and what they fetched. Keyed by the looter's character
// NAME, because pieces cannot leave an inventory, so one character's pile is one tally across every
// boss they loot for. See V38__vestige_tranche.sql.
object VestigeTranche : Table("vestige_tranche") {
    val id = uuid("id")
    val userId = reference("user_id", Users.id)

    // Whose pile this is: PERSON, SELF or CHARACTER, with exactly the reference that kind needs.
    // A character is not the unit here, a human is. See V39.
    val holderKind = text("holder_kind")
    val personId = optReference("person_id", Person.id)
    val characterName = text("character_name").nullable()
    val pieces = integer("pieces")

    // SOLD or KEPT. A redemption is a sale minus the money, and its pieces come out of the pile
    // every price is derived from rather than being priced at nothing. See V46.
    val disposition = text("disposition")

    // The whole tranche's mesos, as reported. The per-piece figure is derived, never stored. Null on
    // a KEPT row, where there is no sale and so no price.
    val amount = long("amount").nullable()
    val soldAt = timestamp("sold_at")
    val createdAt = timestamp("created_at")

    override val primaryKey = PrimaryKey(id)
}

// How many pieces of one sale belonged to somebody else. Only the count is stored; their share of the
// money is derived from the tranche's own amount on read, so correcting the amount moves it.
// See V56__collection_balance.sql.
object VestigeTrancheShare : Table("vestige_tranche_share") {
    val id = uuid("id")
    val trancheId = reference("tranche_id", VestigeTranche.id)

    // vestige_tranche's holder shape, naming the CREDITOR rather than the pile. See V39.
    val holderKind = text("holder_kind")
    val personId = optReference("person_id", Person.id)
    val characterName = text("character_name").nullable()

    val pieces = integer("pieces")
    val createdAt = timestamp("created_at")

    override val primaryKey = PrimaryKey(id)
}

// Mesos somebody owes you that no drop accounts for. Rows rather than a running total, the shape
// V51 uses and for the same reason. Signed since V57. Created as collection_debt by
// V56__collection_balance.sql and renamed by V60.
object SettlementDebt : Table("settlement_debt") {
    val id = uuid("id")
    val userId = reference("user_id", Users.id)

    val holderKind = text("holder_kind")
    val personId = optReference("person_id", Person.id)
    val characterName = text("character_name").nullable()

    val amount = long("amount")
    val note = text("note").nullable()
    val incurredAt = timestamp("incurred_at")
    val createdAt = timestamp("created_at")

    override val primaryKey = PrimaryKey(id)
}

// The shares an offset discharged, as (loot, member) pairs. Empty on a hand-entered debt: somebody
// typing "he owes me 1.5b" is naming no shares. Created by V58__collection_debt_payout.sql and
// renamed by V60.
object SettlementDebtPayout : Table("settlement_debt_payout") {
    val debtId = reference("debt_id", SettlementDebt.id)
    val lootId = reference("loot_id", PartyLoot.id)
    val memberId = reference("member_id", PartyMember.id)

    override val primaryKey = PrimaryKey(debtId, lootId, memberId)
}

// Mesos actually received from a holder, against what their whole pile owes. No pieces: which boss a
// meso pays for is the queue's business, and storing it here would be storing a derived share.
// See V51__vestige_payment.sql.
object VestigePayment : Table("vestige_payment") {
    val id = uuid("id")
    val userId = reference("user_id", Users.id)

    // vestige_tranche's holder shape, kind for kind: it is the same pile being talked about.
    val holderKind = text("holder_kind")
    val personId = optReference("person_id", Person.id)
    val characterName = text("character_name").nullable()

    val amount = long("amount")

    // What it was for. Never read by the netting: a payment is against the whole debt. See V64.
    val note = text("note").nullable()
    val receivedAt = timestamp("received_at")
    val createdAt = timestamp("created_at")

    override val primaryKey = PrimaryKey(id)
}

// What became of the mesos from selling somebody else's coupons: taken off what they owe you, or sent
// to them. A running figure per holder rather than a link to a tranche, so a sale entered next week is
// undecided the moment it lands. See V61__proceeds_disposal.sql.
object VestigeProceedsDisposal : Table("vestige_proceeds_disposal") {
    val id = uuid("id")
    val userId = reference("user_id", Users.id)

    val holderKind = text("holder_kind")
    val personId = optReference("person_id", Person.id)
    val characterName = text("character_name").nullable()

    // Positive always. Which direction it went is `kind`, never a sign.
    val amount = long("amount")
    val kind = text("kind")

    val decidedAt = timestamp("decided_at")
    val createdAt = timestamp("created_at")

    override val primaryKey = PrimaryKey(id)
}

// One act of closing a holder's books, and which drops it closed. `unpaid` is what was still owed at
// that moment, stored once per act and never split across the drops: that split would be a derived
// share. See V52__vestige_settlement.sql.
object VestigeSettlement : Table("vestige_settlement") {
    val id = uuid("id")
    val userId = reference("user_id", Users.id)

    val holderKind = text("holder_kind")
    val personId = optReference("person_id", Person.id)
    val characterName = text("character_name").nullable()

    val unpaid = long("unpaid")
    val settledAt = timestamp("settled_at")
    val createdAt = timestamp("created_at")

    override val primaryKey = PrimaryKey(id)
}

object VestigeSettlementLoot : Table("vestige_settlement_loot") {
    val settlementId = reference("settlement_id", VestigeSettlement.id)
    val lootId = reference("loot_id", PartyLoot.id)

    override val primaryKey = PrimaryKey(settlementId, lootId)
}

object PartyLootPayout : Table("party_loot_payout") {
    val lootId = reference("loot_id", PartyLoot.id)
    val memberId = reference("member_id", PartyMember.id)
    val paid = bool("paid")
    val paidAt = timestamp("paid_at").nullable()

    // How many shares of this sale they take, pinned with it. 1 in an even split.
    val shares = integer("shares")

    override val primaryKey = PrimaryKey(lootId, memberId)
}

// Which seat picked up how many of a drop's stacks. No rows means nobody has said, which is NOT
// the same as the drop having divided evenly. See V41__loot_bundles.sql.
object PartyLootBundle : Table("party_loot_bundle") {
    val lootId = reference("loot_id", PartyLoot.id)
    val memberId = reference("member_id", PartyMember.id)
    val bundles = integer("bundles")

    override val primaryKey = PrimaryKey(lootId, memberId)
}

// Cached Nexon sprite bytes, keyed by sha256 of the source URL. Content-addressed, because the URL
// encodes the outfit: the bytes at a given URL never change, so a row never needs invalidating and
// two seats in identical gear share one. See V53__character_sprite_cache.sql.
object CharacterSprite : Table("character_sprite") {
    val urlSha256 = char("url_sha256", SPRITE_KEY_LENGTH)
    val sourceUrl = text("source_url")

    // Null until a warm succeeds. The route redirects to sourceUrl in that state.
    val image = binary("image").nullable()
    val fetchedAt = timestamp("fetched_at").nullable()
    val createdAt = timestamp("created_at")

    override val primaryKey = PrimaryKey(urlSha256)
}
