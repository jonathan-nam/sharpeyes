# Shared parties: roles, editors and one book per pair

Status: proposed, 2026-10-20. Nothing here is built.

## The problem

Bro owed Jonathan for months, so Jonathan looted every drop and recorded every sale. Now Jonathan
owes Bro 48b, so the cheap direction has flipped: Bro should loot and sell, and Bro's share of
each sale stays with him instead of crossing the Auction House twice. Today Bro cannot record any
of that. Every party write checks `ownsParty` (`parties/PartyQueries.kt:188`), and a seated member
can only read and leave.

**Who loots moves with the debt, so who records cannot be tied to who owns.** It is not a role
that gets handed back and forth. Both people need to be able to record, and the record has to say
who did each thing.

## Today's seams (what this builds on)

- A party is one row with one owner (`party.user_id`, V75).
- A member is a seat bound to a character on their own account: `party_member.linked_character_id
  -> characters.user_id`. Set on invite accept (`InviteAccept.kt` `bindSeats`) and on any roster
  write.
- `canReadParty` / `isSeatedIn` (`parties/SeatedParties.kt:121`) is the only cross-account read
  path. Members read the owner's whole pool, read-only (`yours = false`).
- `person.linked_user_id` says which account a People-page person turned out to be. Nothing
  authorises off it.
- Every settlement table (`settlement_debt`, `vestige_payment`, `vestige_tranche`,
  `vestige_proceeds_disposal`, `vestige_settlement`) is keyed by `user_id` and names the
  counterparty by a holder triple from that user's point of view. The drop-log page reads only the
  caller's own rows (`pages/DropLogPageRoutes.kt`), so a member never sees the pair's ledger.
- `party_loot` records nothing about who wrote it, and nothing stops a night being logged twice
  except `alreadyFiled` for clear-generated rows.

## The model

**Owner.** One per party. Settings, roster, delete, skip, sharing and roles. Unchanged.

**Members get a role per party:** Viewer (today's behaviour) or Editor. Granted per (party,
account), the way a Drive file is shared. Commenter is left out until there is something to
comment on.

**An Editor records what passed through their own hands:**

- log a drop on the party's pool
- record a sale where the seller is one of **their own seats**
- mark a drop kept by their own seat
- mark payouts **they owe** as sent

An Editor cannot name somebody else as the seller, change the roster or settings, or mark a share
paid that is owed **to** them. A payment counts when the person who received it records it. That
keeps the debtor from being the one who says a debt is gone.

**People page.** A person stays the owner's address book entry, and hand-assigned characters stay
the truth for anyone who has not joined. Once a person is linked to an account, that account's
own characters are authoritative and the hand-assigned list is a fallback (this is already how
`linkedCharactersFor` binds seats). The role shows on the person's row, per party they share.

**One book per party owner.** The settlement rows for a party stay in the owner's account, keyed
the way they are today. A member reads the owner's book **for their own pair only**, with the
directions flipped: Jonathan's "you owe Bro 48b" is Bro's "Jonathan owes you 48b". A write an
Editor makes lands in the owner's book with the editor as the holder. This avoids two copies of one
debt that can drift.

Open question: a pair who share parties owned by **both** of them has two books. Phase 3 shows
both cards side by side and does not net them, the same rule as the per-party wash.

## Phases

### Phase 1. Roles (backend + Party View)

- V83: `party_share(party_id, user_id, role)`, role `VIEWER | EDITOR`, unique on (party_id,
  user_id). Backfilled VIEWER for every account with a linked standing seat today. Created on
  invite accept and seat binding, removed on leave and unlink.
- `canEditParty(userId, partyId)` = owner, or a share with role EDITOR and a standing seat.
- Owner sets the role from the party's member list. A member sees their role.
- Tests: Viewer refused on every write route below; Editor refused on config routes; leave and
  unlink drop the share.

### Phase 2. Editor writes

- `party_loot.recorded_by_user_id` and `party_loot.sale_recorded_by_user_id`, nullable, so every
  row says whose keyboard it came from. Old rows stay null (owner).
- Swap `ownsParty` for `canEditParty` on: add loot, delete loot (own rows only), sell / unsell
  (seller must be the caller's seat), lot sale, taken, and payouts the caller owes. Config, roster,
  skip, pieces, clear and delete party stay on `ownsParty`.
- **Duplicate guard, before this ships.** Two keyboards on one pool is how one night gets logged
  twice. Adding a drop that matches an existing row (same party, boss, drop, week) is refused
  unless the request says it is a second copy. Not a unique index, because two copies of one drop
  in one night are real. Applies to the owner too.
- Party View for an Editor: the drop form, and the sale form with only their own seats in Sold By.
- The Sales tab on the Drop Log lists rows in shared pools where the caller's seat holds them.

At the end of phase 2 Bro can record his own sales, and Jonathan's settlement card updates from
them without Jonathan entering anything.

### Phase 3. The member's view of the book

- A read that returns the owner's settlement rows for one pair, flipped to the member's point of
  view. Built on the same `buildSettlement`, not a second implementation.
- Bro's Settlement page shows a card for Jonathan from Jonathan's book, read-only, with the
  Offset and Mark Sent acts he is allowed (his own sent payouts).
- Recording a payment received from the other person in the pair, from either account, written to
  the owner's book.
- Verify by sum: for Jonathan and Bro, the two views must state the same figure in opposite
  directions. Pin it with a test over real dumped rows.

## Not in scope

- Who should loot this week. The direction of the debt already says it, and the app does not need
  to tell anyone. Revisit only if it is asked for.
- Merging two owners' books into one pair ledger.
- Comments.
