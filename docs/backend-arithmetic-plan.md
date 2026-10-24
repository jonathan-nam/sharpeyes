# Money arithmetic on the backend

Status: proposed 2026-10-24. Nothing built.

## The problem

Every split, share, settlement figure and coupon count is worked out in the browser. The backend
stores only what somebody typed (a price, a share count, who has been paid) and serves it raw. That
was a deliberate rule from #134 (`LootDtos.kt`: "No share, payout or fee is computed here or
stored"), and its purpose was one copy of the arithmetic.

Android and iOS apps are coming. With the arithmetic in `frontend/lib`, each app either carries its
own copy (Kotlin, Swift: three copies that drift, which is the plausible wrong number this repo
exists to prevent) or embeds a JavaScript engine to run the web's. **The only place one copy can
serve every client is the server.** The rule keeps its purpose and changes its address.

It also fixes things that hurt today:

- **The backend cannot see a figure move.** Settlement listings (#827) have the browser report each
  card's figure so the server can drop a stale screenshot, and a split notification waits until the
  payer next opens the Drop Log.
- **Two accounts can disagree about one card.** The owner's page drops runs logged in both books
  (`lib/duplicate-runs.ts`); the member's card reads the raw book (`sharedCard`). One computation
  on the server is one answer.
- **The server trusts amounts it cannot check.** An offset's amount is the client's `splitOf`; the
  backend stores whatever arrives. A lot sale is at least checked to add up (`LootValidation.kt`),
  but the division is still the client's.

## What moves

The money modules in `frontend/lib`, in dependency order (each imports only what is above it):

| Module | Lines | What it is |
| --- | --- | --- |
| `drop-split.ts` | 360 | The split itself: the Auction House fee paid twice, rounding. 47 tests. |
| `shares.ts`, `stacks.ts`, `vestige-stacks.ts` | 327 | Share weights and stack arrangements. No money. |
| `piece-ledger.ts` | 409 | Who is short and over on a drop that arrives in pieces. |
| `loot.ts` | 363 | Feeds a recorded sale into the split: MVP fee rates, payout rows. |
| `wallet.ts` | 246 | Which side of each unpaid share you are on. |
| `vestige-ledger.ts` | 1406 | The coupon queue: who holds what, what each holder was entitled to. |
| `settlement.ts`, `settlement-view.ts` | 1542 | One card per person: money, pieces, offsets, held money. 137 tests. |
| `duplicate-runs.ts`, `shared-history.ts`, `shared-book.ts`, `shared-pile.ts` | 403 | The shared book read from the member's side. |
| `drop-log.ts`, `settled-log.ts`, `drop-audit.ts`, `ledger-fates.ts` | ~1990 | The Drop Log, Settled tab and one drop's history. |
| `lot-sale.ts` | 409 | Dividing one sale over a queue of rows (largest remainder). |

About 7,450 lines and roughly 650 tests (counted 2026-10-24). Screens that call into them today: the Drop Log
(`/bosses/drops`, `/bosses/drops/[loot]`), Party View (`/bosses/parties`, the party page), the
Split calculator (`/bosses/split`), and the loot row, sale form, lot sale, settled view and
settlement cards.

**Not in scope:** the Party Planner, Run Order and boss clear logic. They are not money and nothing
counts on them, but the same argument applies to them later (see Phase 0).

## Approach: a Kotlin port, proven against the TypeScript

Port the modules to a `backend/.../money/` package. The backend reads the database and computes
inside the same transaction as the write: no extra hop, no second runtime.

**Rejected: run the TypeScript on a Node service.** Least work today, and it keeps one copy. But it
bakes in a service whose only job is hosting the frontend's code, every page read becomes two
network hops, and the computation cannot share the writer's transaction.

**Deferred: Kotlin Multiplatform.** A shared module could run on the server and inside the Android
and iOS apps. Worth it only if the apps need to compute offline, which they cannot usefully do
without the data anyway. Revisit once the app's stack is chosen.

A rewrite of money arithmetic is exactly where a confident wrong number gets in, so the port is not
trusted until it has matched the TypeScript on real data.

## Phases

### Phase 0: stop adding to the client copy

No new money arithmetic in `frontend/lib`. Add the rule to `CLAUDE.md` beside "Source of truth" so
it binds every session. Work already open (#827's `heldMesos`) is ported with the rest.

### Phase 1: golden fixtures

A script runs the TypeScript over a set of inputs and writes inputs and outputs as JSON into
`backend/src/test/resources/money-golden/`. The inputs are the existing vitest cases plus a
generated spread (odd party sizes, MVP mixes, shares that do not divide, dollar sales, negative
debts, coupon piles that wash).

A CI job regenerates them and fails on a diff, the way `catalog is in sync` guards the catalog, so
a change to the TypeScript during the port cannot leave the fixtures behind. Add the job to the
`required-checks` gate's `needs`, or it fails where nobody sees it.

### Phase 2: port, leaf first

In the table's order, each module in its own PR, each passing every golden case for its functions
**exactly** before it merges. A fixture the port gets wrong is a failing test, never an updated
fixture.

Parity traps to check deliberately, not discover:

- **Rounding.** JS `Math.round` rounds half towards positive infinity. Kotlin's `kotlin.math.round`
  rounds half to EVEN; `Math.round` (Java) matches JS. Pick one and pin it with a half-way case.
- **Integer width.** Mesos fit a JS number below 2^53 and a Kotlin `Long` either way, but any
  intermediate the TypeScript does in floating point (a fee, a ratio) must be floating point in the
  port too, in the same order of operations.
- **Tie-breaks.** Largest remainder and every sort that decides who gets the odd meso or the odd
  stack must break ties on the same key, in the same order.
- **Weeks.** Anything keyed by a boss period uses the backend's existing period boundary, never a
  re-derivation.

### Phase 3: serve the figures

The page endpoints (`/api/pages/drop-log`, `/api/pages/shared-books`, the parties page) gain the
computed views as **additive** fields: each card's figures, each drop's split, the queues. Nothing
reads them yet. The member's card is computed on the server from the owner's book with the viewer
passed in, which is what makes both sides one answer.

A tab's cached payload will lack the new fields after the deploy (see the client-cache note in the
project memory), so every read of them falls back until Phase 5 removes the fallback.

### Phase 4: shadow mode

The web keeps computing as today and also reads the server's figures. Where they differ it reports
the mismatch (card key, both figures, which field) through the existing client error beacon
(`POST /api/errors`), and draws its own figure.

It also runs offline: dump prod rows as DTO-shaped JSON (the audit recipe in the project memory)
and diff both implementations over every card.

**Gate:** zero mismatches over at least two weeks of prod traffic, covering at least one coupon
settlement and one offset. Any mismatch is a port bug until shown otherwise.

### Phase 5: flip the reads

Components draw the server's fields. Each TypeScript module is deleted once nothing imports it, and
its tests are already Kotlin by then. The comments that say "Nothing here computes a meso, every
number comes off lib/settlement.ts" are rewritten to point at the backend, or they become
confidently wrong.

The Split calculator needs an answer per keystroke. Either a small endpoint it debounces against,
or `drop-split` is the one module that stays duplicated, pinned by the golden fixtures in both
languages. See open questions.

### Phase 6: flip the writes

Writes send the act, not the arithmetic. Offset and Mark Sent name which shares; the server prices
them. A lot sale names the rows; the server divides it. Client-supplied amounts on those routes are
refused once every client is on the new shape.

Settlement listings (#827) drop their figure-reporting endpoint: the server records each card's
figure inside the write that moves it, and `SPLIT_UPDATED` fires at the moment of the sale.

### Phase 7: native apps

The apps render what the API returns and compute nothing.

## Open questions

- **Which stack are the apps?** React Native could run the TypeScript, but that does not change the
  answer: notifications and cross-account agreement still need the server to know the figure.
- **The Split calculator:** a debounced endpoint, or the one deliberate duplicate?
- **#827 now or later:** merge it as a stopgap (its storage, notifications and UI survive; only the
  figure reporting is replaced in Phase 6), or hold it for the port?
- **Planner and clears:** the same rule after money, or only when the apps need them?
