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

- V83: `party_role(party_id, user_id, role)`, keyed on (party_id, user_id). Only Editors get a
  row: no row is a Viewer, so nothing is backfilled and nothing has to follow seat binding. Leave
  and unlink delete it.
- `canEditParty(partyId, userId)` = owner, or an Editor row and a standing seat. The seat still
  grants access, so a row alone is never a way in.
- Owner sets the role from the party's member list. A member sees their role.
- Tests: Viewer refused on every write route below; Editor refused on config routes; leave and
  unlink drop the share.

### Phase 2. Editor writes

- V84: `party_loot.recorded_by_user_id`, nullable. Null is the owner, which every older row is.
  The sale needs no column of its own: its seller is the seat that recorded it.
- `canEditParty` instead of `ownsParty` on: add loot, sell / unsell, taken, and delete. An Editor
  acts only as their own seats (`mayActAs`): sells as themselves, corrects or undoes only their own
  sale, marks kept or puts back only as themselves, and deletes only an unsold drop they logged
  (`LootPermissions.kt`). Config, roster, skip, pieces, clear, bundles, lot sale and delete party
  stay on `ownsParty`.
- **Payouts stay the owner's.** "Mark payouts they owe as sent" contradicts "a payment counts when
  the receiver records it", so it was left out. Revisit with phase 3's payments.
- **Duplicate guard.** Adding a drop that matches an existing row (same party, drop, and period of
  its boss) is a 409 unless the request says `again`. Not a unique index, because two copies of one
  drop in one period are real. Applies to the owner too. The picker offers Add Again.
- Party View for an Editor: the drop picker, Mark Sold with only their own seats in Sold By, Undo
  Sale on their own sales, Remove on their own unsold drops.
- **Deferred to phase 3:** the Drop Log's Sales tab listing shared pools. It is built from the
  caller's own ledgers, and a member's pool there means reading the owner's book.

At the end of phase 2 Bro can record his own sales on the shared party's page, and Jonathan's
settlement card updates from them without Jonathan entering anything.

### Phase 3. The member's view of the book

- `GET /api/pages/shared-books`: for each person row linked to your account, the owner's book read
  AS the owner and cut to the pair. Parties with a seat the owner files under your person row,
  their pools, and the debts, payments, disposals and closures that name you. Their own pile's
  sales stay whole (a sale re-prices the pile), with shares naming anybody else stripped.
- The client runs the same `settlementView` over it, takes `person:<you>`, and swaps it
  (`lib/shared-book.ts`). Read-only cards under Shared Parties on the Settlement tab.
- Not yet: recording a payment from the member's side, and the Sales tab for shared pools.

## Not in scope

- Who should loot this week. The direction of the debt already says it, and the app does not need
  to tell anyone. Revisit only if it is asked for.
- Merging two owners' books into one pair ledger.
- Comments.
