# Shared modules

What the backend and the clients (the website now, Android and iOS later) share as Kotlin, and what
should move there next. The money port has its own plan, `docs/backend-arithmetic-plan.md`.

## What is shared

Two Kotlin Multiplatform builds under `shared/`, each its own Gradle build that the backend includes
(`includeBuild`), both taking versions from `gradle/libs.versions.toml`.

```
shared/
  api/     com.sharpeyes.api      every request and response body, and apiJson
    bosses/ characters/ coupons/ events/ friends/ inventory/ invites/ loot/
    notifications/ pages/ parties/ planner/ screenshots/ settings/ settlement/ sprites/ system/
  money/   com.sharpeyes.money    the ledger arithmetic, ported from frontend/lib
    (root: Model.kt inputs, JavaScript-parity helpers, World.kt)
    split/ sales/ pieces/ coupons/ settlement/ droplog/ sharedparties/
```

Packages, files and API classes are named in the screens' words: `coupons`, not vestige; items, not
tokens (`ItemCatalogResponse`); a coupon sale, not a tranche (`CouponSaleResponse`); held money,
not a proceeds disposal (`HeldMoneyResponse`); `sales/BulkSale.kt` for the card that sells several
of one drop at once. The URLs and database names keep the older words (`/api/vestige-*`,
`/api/tokens`, `vestige_tranche`), and money's classes keep the TypeScript's names (`Wallet` in
`split/OwedShares.kt`, `VestigeTranche` in `Model.kt`) until each TypeScript module is deleted, since
the golden fixtures are keyed by them.

### What goes in `shared/api`

Anything that crosses the wire: request and response bodies, the SSE payload, the two beacon bodies,
and the constants and enums a body's defaults or values name (`SOLD`, `KEPT`, `BOUGHT`, `HELD_BY_YOU`,
`HELD_BY_THEM`, `PieceSyncGap`, `ScreenshotOutcome`).

What stays in the backend, though it is `@Serializable`:

- The invite payload (`InvitePayload` and its three parts). It is a database column, versioned by
  `INVITE_PAYLOAD_VERSION` and written with the default `Json`, not a body.
- The NOTIFY `Event`, the vision client's and Nexon's response shapes, and the screenshot parse
  result. Internal, or another service's contract.

Encode and decode with `apiJson` (`ignoreUnknownKeys`, `encodeDefaults`). The Drop Log figures route
is the one exception: it serves `moneyJson`, which omits nulls.

### `money`'s Model.kt is not the API

`Model.kt` is a projection of the TypeScript types: every number a `Double`, every TypeScript-optional
field nullable. It matches the served JSON and keeps the golden fixtures byte-for-byte. Moving the
arithmetic onto the API types (`Int`/`Long`) is a separate decision, made once the TypeScript copy of
a module is deleted.

## The TypeScript is checked against it

Before this, `frontend/types/*.ts` was a hand copy that had already dropped two request fields
(`LogDropBody.droppedOn`, `AddSettlementDebtBody.incurredAt`) with nothing to catch it. Now:

- **`frontend/types/generated/api.ts`** is rendered from shared/api by `GeneratedTypesTest` (its
  jvmTest), which walks every class's `SerialDescriptor`. Committed, so Vercel never needs a JVM. The
  test fails when the file differs; `UPDATE_API_TYPES=1 ./gradlew -p ../shared/api jvmTest` from
  backend/ rewrites it. The backend's `test` runs it, so CI does too.
- A default is optional (`?:`) only on a body the server decodes (`*Request`, the two beacons) and
  its parts. Everywhere else it is sent, so it is required.
- **`@AbsentOnCachedPayload`** marks a field the server always sends that a tab's cache can predate.
  The generated type makes it optional, so the reader has to say what absent means. 31 fields carry
  it, plus `recordedByYou`/`recordedByName` on four ledger rows.
- **`frontend/types/generated/parity.ts`** makes tsc fail when a hand type drifts: a response must
  match its generated type both ways, a request body only has to be accepted. The only differences
  allowed are written there: unions the TypeScript narrows a `String` to (`WorldType`, `Holder.kind`,
  dispositions, `heldBy`, `Payer`) and five always-sent fields that values built in the frontend
  leave out. `lib/type-parity.test.ts` fails when a type in types/ has no line there.

The hand files stay for now because they carry frontend notes the Kotlin does not ("resolve with
spriteUrl()"). A file becomes pure aliases (`export type Boss = api.BossResponse`) once its notes
are in the Kotlin's KDoc. Turning the narrowed `String`s into Kotlin enums would let those unions
come from the generator too.

Kotlin/JS export was rejected: it ships runtime classes rather than JSON shapes, and needs a JVM at
build time or a committed bundle. OpenAPI would also type the routes, at the cost of annotating
every one; worth it only once typed fetch calls are wanted.

## Next: rules that should be on the server, or shared

From a survey of every page and the 107 modules in `frontend/lib`. In order of what a native app
would otherwise have to re-implement, or what is already two copies that can disagree.

1. **Drop eligibility.** `drop-picker.ts` and `world.ts dropExistsIn` decide which drops a boss
   gives at a difficulty and in a world. The server checks only that a `dropKey` exists
   (`LootRoutes.kt`, `LootLogRoute.kt`), so it accepts loot the UI would never offer.
2. **Week and period rules.** `parties.ts isSpentOneOff` mirrors `PartySkip.kt`, `partiedBossKeys`
   mirrors the server's `partiedNames`, and `boss-clears.ts weekEndExclusive` adds seven days in the
   browser rather than reading `BossPeriod.kt`.
3. **Pile split.** `piece-stacks.ts splitStacks` says it is "the backend's splitStacks
   (tokens/PiecePiles.kt)"; no such function exists. `piece-pile.ts pileProblem` repeats
   `editPile`'s checks. One Kotlin function should divide and refuse.
4. **The rest of the money.** `shares`, `stacks`, `vestige-stacks`, `vestige-pickup`, `pool-nights`,
   `redemption`, `sale-logger` and meso parsing are unported, and ledger inputs depend on them.
5. **Run Order.** `boss-run-plan.ts` and `boss-night.ts`, about 1,340 lines deciding which runs are
   eligible and in what order. A `planning` module.
6. **Party Planner.** `party-planner.ts`, which hard-codes `PLANNER_BOSSES` and `ONE_PER_PARTY`,
   catalog data written in TypeScript.
7. **Client-computed amounts.** Lot sales, `splitOf` and offset amounts are ported, but writes still
   send the client's figure (the arithmetic plan's Phase 6).

### Constants written twice

Each belongs in `shared/api` (or the catalog) and nowhere else.

| What | Frontend | Backend |
|---|---|---|
| Party size 6 | `parties.ts MAX_PARTY` | `PartyQueries.kt MAX_PARTY_SIZE` |
| Run minutes 600 | `boss-minutes.ts MAX_MINUTES` | `PartyQueries.kt MAX_RUN_MINUTES` |
| Shares 99 | `shares.ts`, `party-planner.ts` | `PartyQueries.kt MAX_SHARES` |
| Quantity 1,000,000 | `count-stepper.ts`, `drop-picker.ts` | `CharacterTokenWrites.kt`, `LootValidation.kt` |
| IGN length 12, lookup names 30 | `ign.ts`, `ign-sprites.ts` | `IgnSprites.kt` |
| Live topics | `live-events.ts TOPICS` | `events/Topic.kt` |
| Notification kinds | `types/notifications.ts` | `NotificationKind.kt` |
| Loot statuses, holder kinds, disposal kinds | literals in `drop-log.ts`, `vestige-ledger.ts`, `drop-audit.ts` | literals in the routes |

`stacks.ts MAX_STACK_HALVES` (24) has no server check at all.
