# Shared modules

What the backend and the clients (the website now, Android and iOS later) share as Kotlin, and what
should move there next. The money port has its own plan, `docs/backend-arithmetic-plan.md`.

## What is shared

Two Kotlin Multiplatform builds under `shared/`, each its own Gradle build that the backend includes
(`includeBuild`), both taking versions from `gradle/libs.versions.toml`.

```
shared/
  api/     com.sharpeyes.api      every request and response body, and apiJson
    bosses/ characters/ combine/ events/ friends/ invites/ loot/ notifications/
    pages/ parties/ planner/ screenshots/ sprites/ system/ tokens/ users/ vestige/
  money/   com.sharpeyes.money    the ledger arithmetic, ported from frontend/lib
    (root: Model.kt inputs, JavaScript-parity helpers, World.kt)
    split/ lots/ pieces/ coupons/ settlement/ droplog/ shared/
```

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

## Next: generate the TypeScript (PR 2)

`frontend/types/*.ts` is still a hand copy. A survey of the 84 exported types found two request
fields it had dropped (`LogDropBody.droppedOn`, `AddSettlementDebtBody.incurredAt`), fixed with this
module. Nothing caught them.

The plan: a Gradle task in `shared/api` that walks each class's `SerialDescriptor` and writes
`frontend/types/generated/*.ts`, committed. CI runs it and fails on `git diff`. Vercel never needs a
JVM.

- `Long`, `Int`, `Double` become `number`; `JsonElement` becomes `unknown`; a map becomes `Record`.
- 31 response fields are optional in the TypeScript only because a tab's cache can predate them
  ("Absent on a cached payload"). Kotlin has them required or defaulted, so a plain generator would
  make them required. A `@SerialInfo` annotation marks them, and the task emits `?:`.
- The string unions only the TypeScript has (`worldType`, `disposition`, `heldBy`, `Holder.kind`)
  become Kotlin enums, which the backend wants anyway.
- The hand files become aliases (`export type Party = PartyResponse`), one file at a time.

Kotlin/JS export was rejected: it ships runtime classes rather than JSON shapes, and needs a JVM at
build time or a committed bundle.

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
