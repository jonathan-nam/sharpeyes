# Working in this repo

## UI copy is not commentary

**Never put internal narration on screen.** The reasoning behind a rule belongs in a comment or a
commit message. What the user sees is the rule's effect, in as few words as the screen can carry.

This went wrong on Party View, which grew to:

> A past week. Clears are read-only here, and only weekly bosses can be answered for. 20 configs
> are not shown either, having been set up after this week.

Three internal facts nobody asked for, and "either" dangling off a clause that was not rendered.
It says the same thing as:

> Past week, read-only. Weekly bosses only. 20 newer parties hidden.

Concretely:

- Say the effect, not the mechanism. "Weekly bosses only", not why a week cannot answer for a
  daily one.
- Use the product's words. A user has *parties*, not *configs*; a *config* is our word for the row.
- One message per fact. A note above the list and an empty line inside it were both explaining the
  same absence.
- Do not explain a design decision on screen. If a caveat cannot be said in a few words, it is a
  tooltip or it is nothing.

None of this licenses a screen that hides what it dropped. A count that changed still gets said, and
"prefer refusing to answer over guessing" still holds. Say it short, not never.

### The default is no prose

Narration is the default failure, so the default has to be silence. **Do not write UI text unless
something on screen is wrong without it.** Adding a sentence is a decision that needs a reason, the
same as adding a comment.

The second time this happened it was not a caveat but an intro, on `/bosses/routine`:

> Pick a character, then untick the bosses they don't run. Unticked bosses stop counting towards
> the week.

A tour of the controls, then the mechanism behind them. The controls are a picker and a list of
checkboxes, which need no instructions, and what unticking does is visible the moment you do it. It
was replaced by a label of what the page is ("Which bosses each character runs."), matching the one
the sibling page carried.

Then every intro in the app went, that one included, so take the rule at its word:

- **Never explain a control.** If a button needs a sentence, fix the button.
- **Pages do not get intros.** The title and the content say what the page is. A one-line label
  naming what is shown is the most that has ever been justified, and it was still cut every time,
  so write none and let it be asked for. The `.split-intro` class they all shared is deleted, so
  writing one back means writing new CSS, which is the point at which to stop.

## Comments

The bar for a comment is: **it says something the code cannot.** A constraint, a measurement, a
rejected alternative, a bug that will come back. Everything else is noise that goes stale.

**Be brief.** Say it once, in the fewest words that survive being wrong later. A comment that
takes three paragraphs to justify a threshold will not be read, and will not be updated when the
threshold moves. Prefer:

- One line for the *what*, only when the code cannot say it.
- A short block for the *why*, but only where the reasoning is genuinely non-obvious and
  expensive to rediscover (a measured number, a design that failed, an invariant).
- A pointer instead of a repeat. If two places share a reason, put it in one and reference it.
  This codebase had the same "per-instance alignment was wrong" paragraph in two files.

**Do not narrate the diff.** No "this used to be X", "I changed this because", "previously we
did Y", unless the old approach is one a future reader would otherwise re-introduce. That is the
only reason to record a dead end, and one sentence is usually enough.

**Numbers in comments are claims.** `0.925 against a 0.55 bar` was cited long after the bar became
0.80, and `6 tokens` long after the catalog reached 26. If you quote a measurement, quote where it
came from, and treat it as something that must be re-measured when its inputs change, or better,
pin it with a test so it cannot silently rot.

**When you change behaviour, grep for the comments that describe it.** Stale comments are worse
than none: they are confidently wrong, and they are believed.

**No em dashes.** Write two sentences. Where the second clause cannot stand alone, use a comma, a
colon, or parentheses. This applies to comments, docs and commit messages alike.

## No PII or real IGNs

Code, tests, comments, docs and commit messages never carry a real person's name, account, email or
character IGN. This repo is public. Use invented values instead ("Thornwick", "Pellmoor"), and
invent them whole: a real IGN with a letter added or changed is still that IGN.

Describe a reported case by its shape ("a passenger whose only soloer is the same player"), not by
who reported it. Real names belong in conversation, never in the tree.

Older code still holds some, notably the vision HUD tests, whose fixture captures show the names.
Do not add more. Versioned migrations (`V*__*.sql`) cannot be edited at all, comments included:
Flyway checksums every applied one and a changed file stops the backend from booting.

## The failure this project exists to prevent

A **plausible, confident, wrong number**. Not a crash, a count that looks right and is not.
Everything else is secondary. Concretely, this has already happened via: a shortlist that silently
dropped an item; a prefilter that binned one real match in eight; an aggregate that pooled
redemption pieces which cannot be pooled; and an OCR path that resampled its own evidence away
before reading it.

So: prefer refusing to answer over guessing, prefer a missing item over a wrong count, and never
trust an accuracy figure measured through a step you also control.

## Test fixtures

`test-fixtures/` is the vision corpus, not a pile of screenshots. Every file in it is read by a
test in `vision/tests/`, by a build script in `vision/app/cv/`, or by `scripts/smoke.sh`, and
`docker-compose.yml` mounts the directory into the vision container as `/screenshots`. Deleting
one breaks CI, so check who reads it first.

The subdirectories are roles, not file types:

- `inventory/` captures the parser must read correctly.
- `occluded/` captures it must **refuse**. Filing one of these under `inventory/` turns a
  refusal test into a parse test that happens to pass, which is the silent-wrong-number failure
  this repo exists to prevent.
- `planner/` boss clear menu captures.
- `hud/` name and level crops.

Tests reach the corpus through `vision/tests/fixtures.py`, never by rebuilding the path. Two
captures are also build inputs, so moving them silently changes generated templates:
`inventory/untradeables sample.png` builds the digit font sheet, and
`planner/boss clear menu sample 2.png` builds the planner state glyphs.

`test-fixtures/scratch/` is the opposite: gitignored, disposable, the place to drop a capture
that illustrates a feature or a bug. A capture graduates by moving into a role directory and
gaining a test that reads it, in the same commit. If it never gets a test it stays scratch.

## Source of truth

`catalog/items.yaml` defines every item. `catalog/build.py` generates the SQL seed and validates
that templates and icons exist. Never edit `R__token_catalog.sql` by hand, and never add an item
in only one place, that drift is exactly what the manifest exists to end.

### Money arithmetic is moving to a shared Kotlin module

Splits, shares and settlement figures are being ported from `frontend/lib` to `shared/money`, a
Kotlin Multiplatform module the backend runs on the JVM and the Android and iOS apps will share. It
is its own Gradle build, which the backend includes (`includeBuild`), and every Kotlin build takes its
versions from `gradle/libs.versions.toml`. The plan is `docs/backend-arithmetic-plan.md`.

- **Add no new money arithmetic to `frontend/lib`.** A new figure goes in `shared/money`.
- **`commonMain` is common code only.** No `java.*`, no JVM-only library: a platform reaches common
  code through an `expect`/`actual`, as `localeCompare` does. The tests are common too
  (`commonTest`), and reach their fixtures the same way (`Fixture.kt`), so every target runs them.
- **Until a module is deleted, both copies must agree exactly.** `shared/money/src/commonTest/
  resources/money-golden/` holds the TypeScript's answers, regenerated by the `*.golden.test.ts` files.
  Changing the TypeScript means `UPDATE_GOLDEN=1 pnpm vitest run` and the Kotlin port changed to
  match, in the same PR. Never edit a fixture by hand, and never update one to make the port pass.

### The API's types live in `shared/api`

Every request and response body the backend serves is a `@Serializable` class in `shared/api`, built
and included like `shared/money`, one package per feature (`com.sharpeyes.api.parties`, `.coupons`,
`.settlement`, ...), named in the words the screens use. The plan is `docs/shared-modules-plan.md`.

- **A new endpoint's body goes in `shared/api`**, never beside its route. Only what goes over the
  wire does: a database payload or a vision response stays in the backend.
- **The server encodes with `apiJson`.** A client decoding with it reads exactly what was sent.
- Until the TypeScript is generated from it, `frontend/types/` is a hand copy, so change both.
