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
    val characterId: String?,
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
    val createdAt: String,
    val updatedAt: String,
)

/** A person, and the characters of theirs you have named. */
@Serializable
data class PersonResponse(
    val id: String,
    val name: String,
    val characters: List<String>,
    /** Their Settlement Ledger card stays drawn with nothing outstanding. See V59. */
    val pinned: Boolean = false,
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
    /**
     * Parties to take these members OUT of, by id, as part of this save.
     *
     * A character can be in one party per boss (see bossRosterClashes), so moving one across used
     * to mean emptying the old party in a write of its own, which the screen refused rather than
     * offered. Naming the parties here makes it one save: the seats are released and the roster
     * written in the same transaction, so a move cannot half happen.
     *
     * Ids rather than a "force" flag. The client has been told exactly which parties it is about to
     * take from and says so back; a clash with a party NOT named here is still refused, so agreeing
     * to one move cannot quietly authorise another.
     */
    val releaseFrom: List<String> = emptyList(),
)

/**
 * The one refusal a user can answer: somebody in this roster is in another party for this boss.
 *
 * Sent instead of the flat message so the screen can offer the move rather than restate the
 * problem. Each entry is a party the save would have to take a seat from, and whether that leaves
 * the party standing. Answering means sending the same save again with those ids in `releaseFrom`.
 */
@Serializable
data class RosterConflictResponse(
    val message: String,
    val moves: List<RosterMoveResponse>,
)

@Serializable
data class RosterMoveResponse(
    val partyId: String,
    /** The seat that would move, named as the other party spells it. */
    val member: String,
    /** Whose party it is being taken from. */
    val fromCharacter: String,
    /** Whether that party is left with nobody else, so the move removes it. */
    val removesParty: Boolean,
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
