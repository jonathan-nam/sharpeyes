package com.sharpeyes.backend.parties

import kotlinx.serialization.Serializable

// Mirrored by the frontend's types/party.ts field-for-field.

/**
 * One seat: a character somebody brought.
 *
 * `personName` is not stored on the seat. It comes from person_character, matched on the character
 * name, so "CreedBratton is Chris's" is stated once and every config that names CreedBratton shows
 * it. Null means that character has not been attributed to anybody yet, which is ordinary.
 */
@Serializable
data class PartyMemberResponse(
    val id: String,
    val name: String,
    val personId: String?,
    val personName: String?,
    // Set when the seat is one of YOUR characters, which happens when you bring two of your own.
    //
    // Load-bearing beyond identifying the seat: the coupon ledger reads a non-null value as SELF,
    // and the roster strip labels the tile "one of your characters". So it stays yours alone, and a
    // seat that is somebody else's real character says so in the next field instead.
    val characterId: String?,
    /**
     * The character row this seat is, on a LINKED person's account.
     *
     * Set for a seat naming a character that person's own account holds. It is what makes the seat
     * a reference to a character rather than a name that happens to match one, and it is where the
     * sprite comes from, their account keeping it fresher than any copy of ours. Never one of
     * yours: see characterId above.
     */
    val linkedCharacterId: String? = null,
    val spriteImgUrl: String?,
    // Not in the party's usual roster: here for this week only, or gone from it since. Said out
    // loud because "who is in this party" and "who ran it that week" now have different answers.
    val guest: Boolean = false,
    // What this seat usually takes of a split. 1 unless somebody carries and the party agreed they
    // take more. Only ever a DEFAULT: a sale pins its own counts, so this cannot rewrite one.
    val shares: Int = 1,
)

/**
 * One config: your character, one boss, and who they run it with.
 *
 * The members are the OTHER characters; your own is `characterId` on the config itself. A boss
 * your character solos has one of these too, flagged `solo`, so that what fell on it has a pool to
 * sit in. It is not a party and is not listed as one: see V30__party_solo.sql.
 */
@Serializable
data class PartyResponse(
    val id: String,
    // How this config addresses itself in a URL: "rune/lomien", the character and the boss, which
    // is what it IS. Falls back to `id` for a character whose name cannot be told from another of
    // yours. See PartySlug.kt.
    val slug: String,
    val characterId: String,
    // The character's world, INTERACTIVE or HEROIC. Carried on the config because it is what
    // decides whether this pool's drops can be sold at all: Heroic worlds do not trade, so a
    // split, a payout and a wallet line are all figures that could never change hands.
    val worldType: String,
    val bossKey: String,
    // Which mode this party runs, one of the boss's own difficulties. Null is not NORMAL, it is
    // nobody having said yet, so nothing draws a difficulty for it.
    val difficulty: String? = null,
    // How long this party takes on this boss, door to door. Null is nobody having timed it, not
    // the flat estimate Run Order falls back to, so the two can be told apart on screen.
    val minutes: Int? = null,
    // Nobody else was there. One seat, no shares to pay, and off every list of parties.
    val solo: Boolean = false,
    // On for one period rather than every one. A boss run once, which is gone next period without
    // being told to, as against a standing arrangement that is on until somebody says otherwise.
    val oneOff: Boolean = false,
    // Taken off the lists, pool kept. Only the wallet and the Drop Log ever see one, and both need
    // to tell it from a live party: it holds real drops, but it is not a boss this character runs.
    // See V33__party_standing.sql.
    val retired: Boolean = false,
    // The seat that picks up the pieces, when the party agreed one member loots the lot. Null is
    // everybody looting their own, which is most parties. Not always one of yours.
    val looterMemberId: String? = null,
    // Who ran in the week being shown, which is not always who usually does. See rostersFor.
    val members: List<PartyMemberResponse>,
    // EVERY seat this party has ever had, guests and departed members included. What a payout is
    // read against: a share owed to somebody who has since left is still owed, and resolving it
    // through `members` would make the drop unreadable the week after they left.
    val seats: List<PartyMemberResponse> = emptyList(),
    // False when this week was spelled out with its own roster. The members alone cannot say so: a
    // week that only drops somebody names no guest and would read as an ordinary one.
    val usualRoster: Boolean = true,
    // Not running this boss in the period being shown, whichever way it got there: a standing party
    // taken off the week, or a one-off whose week has passed. Answers for the week the list was
    // asked for, unlike `cleared` below, which always answers for now.
    val skippedThisPeriod: Boolean = false,
    // The pool at a glance: dropped but unsold, and sold with somebody still unpaid.
    val pendingLoot: Int = 0,
    val awaitingPayout: Int = 0,
    // Sold and settled. Sent so a fully-settled pool still shows on the row: without it, paying
    // the last share made the party's whole drop history disappear from the list.
    val settledLoot: Int = 0,
    // Whether this boss is cleared in the period it is currently in, straight out of boss_clear:
    // the same row the clear matrix draws and a planner capture writes. Null means nobody has said
    // anything about it this period, which is not the same as "not cleared".
    val cleared: Boolean? = null,
    // Ticked here rather than read off a planner. A number you can trace to a capture and one
    // somebody typed are not equally trustworthy, so the two are not drawn identically.
    val clearedByHand: Boolean = false,
    // False for a party somebody else keeps the book for, which you reach by holding a seat in it.
    // Every write on a pool is the owner's, so this is what the screen reads to know it is a
    // reader: two people logging one night is a double count. See isSeatedIn.
    val yours: Boolean = true,
    val createdAt: String,
    val updatedAt: String,
)

/** A person, and the characters of theirs you have named. */
@Serializable
data class PersonResponse(
    val id: String,
    val name: String,
    val characters: List<String>,
    /**
     * The ones their OWN account holds, for a person who has linked (V70).
     *
     * Kept apart from `characters` rather than merged into it because the two are editable
     * differently: what this account said about them can be moved on the People page, and what
     * their account holds cannot. Empty for everybody who does not use the app, which is most of
     * them. See personCharacters.
     */
    val ownedCharacters: List<String> = emptyList(),
    /**
     * They sign in as an account of their own, having accepted a link (V70).
     *
     * Sent as a flag rather than left to be inferred from ownedCharacters: that list is narrowed to
     * characters this account already seats, so somebody linked who shares no party yet has an
     * empty one and would read as unlinked. Which account it is stays unsent.
     */
    val linked: Boolean = false,
    /** Their Settlement Ledger card stays drawn with nothing outstanding. See V59. */
    val pinned: Boolean = false,
)

/**
 * One party you are IN but do not own.
 *
 * Its own response type, not PartyResponse. That one carries pending, awaiting and settled loot
 * counts for the WHOLE pool, and those totals span nights this account was not on.
 *
 * No slug either. A party's URL is built from its OWNER's character slugs and resolves only for
 * them, so handing one to a member would be handing them a 404.
 */
@Serializable
data class SeatedPartyResponse(
    val id: String,
    val bossKey: String,
    val difficulty: String?,
    val minutes: Int?,
    // Every seat, the owner's own character first, as on any config. This is also what says whose
    // party it is: the first seat is the character the config belongs to.
    val seats: List<PartyMemberResponse>,
    // Which of those seats are yours, so the caller never works it out by name.
    val mySeatIds: List<String>,
    /**
     * The nights YOU were on the roster for, and nothing else.
     *
     * The narrowing is by night, which is the whole of what a member is entitled to see: a pool
     * spans months and they were not there for most of it. Within a night they get the party's own
     * record as it stands, unreduced, because they were in the party that night and because a
     * smaller shape would mean a second implementation of the money maths beside splitOf. Two
     * answers to what somebody is owed is worse than one answer they can check.
     */
    val nights: List<LootResponse> = emptyList(),
)

/** PUT /api/people/{personId}/pinned. One flag, so a pin cannot rewrite the people list. */
@Serializable
data class PinPersonRequest(
    val pinned: Boolean,
)

/**
 * A config, as submitted.
 *
 * `members` is the other characters, in the order they should read. Empty is refused: a config
 * with nobody else in it is a solo run, and a solo run is simply not a config.
 */
@Serializable
data class SavePartyRequest(
    val characterId: String,
    val bossKey: String,
    val members: List<String> = emptyList(),
    /**
     * What each seat usually takes of a split, keyed by character name, your own included.
     *
     * The request is the whole roster, so a name left out takes one share: that is what makes
     * clearing a weight a matter of typing 1 rather than a second call to undo it.
     */
    val shares: Map<String, Int> = emptyMap(),
    // One of the boss's own difficulties, or null for "not said". Anything else is refused rather
    // than dropped: a config claiming Normal Black Mage would read as a fact somebody entered.
    val difficulty: String? = null,
    // Minutes door to door, or null for "not timed". Zero is a real answer and is kept as one.
    val minutes: Int? = null,
    // Create this as a one-off, on for this period alone. Read at create only: which kind of config
    // it is decides how every later period reads, so turning a standing party into a one-off after
    // the fact would rewrite weeks it has already answered for.
    val oneOff: Boolean = false,
    /**
     * Who picks up the pieces, by character NAME rather than seat id.
     *
     * A name because that is what the rest of this request is: seats are matched by name, and a party
     * being created has no seat ids yet for the client to send. Null clears it, which is the party
     * going back to everybody looting their own.
     */
    val looterName: String? = null,
)

/**
 * The whole people list, every time.
 *
 * A full replace, because it is one screen you edit as a whole. A person absent from the payload
 * has been removed, and one whose characters shrink has had those attributions taken back; the
 * configs naming those characters keep the characters and simply stop showing an owner.
 */
@Serializable
data class SavePeopleRequest(
    val people: List<PersonRequest> = emptyList(),
)

@Serializable
data class PersonRequest(
    val id: String? = null,
    val name: String,
    val characters: List<String> = emptyList(),
)

/**
 * Who ran this week, as submitted.
 *
 * A null `members` puts the week back to the usual roster, which is a deletion rather than a copy
 * of it: copying would leave a week frozen against every later change to the party.
 *
 * `week` names the week being changed, and only the current one may be. A past week's payouts were
 * pinned when the drops sold, so rewriting who ran then would leave the roster and the money owed
 * disagreeing, with nothing on screen saying which is right.
 */
@Serializable
data class SaveWeekRosterRequest(
    val week: String? = null,
    val members: List<String>? = null,
)

/**
 * Whether the party is running its boss this period.
 *
 * False puts it back, and puts it back by deleting the mark rather than storing a false, so the next
 * period runs as usual without being told to.
 *
 * `week` names the period being changed, and only the current one may be, for the reason the roster
 * gives: a past week's pools were settled against what actually happened, and re-answering "did you
 * run it" afterwards would leave the two disagreeing with nothing on screen saying which is right.
 */
@Serializable
data class SetPartySkipRequest(
    val week: String? = null,
    val skipped: Boolean,
)

/** Ticking a config's boss cleared for the period it is in, or un-ticking it. */
@Serializable
data class SetClearRequest(
    val cleared: Boolean,
)

/**
 * Which mode a character runs a boss at alone.
 *
 * By character and boss rather than by config id: the pool may not exist yet, and naming the mode is
 * what opens it. Null is a real answer, and is what every solo pool says until somebody says
 * otherwise. See setSoloDifficulty.
 */
@Serializable
data class SetSoloDifficultyRequest(
    val characterId: String,
    val bossKey: String,
    val difficulty: String? = null,
)
