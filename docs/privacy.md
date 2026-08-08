# Privacy

An investigation, not a decision. The prompt was that people will not want to expose which
characters they play, who they party with, or what their inventories hold, and that this is a
reason not to sign up at all.

The objection is real. What it is *about* turned out not to be what the phrase suggests.

## What is exposed today, and to whom

**To other users: nothing.** There is no share link, no public profile, no read path from one
account into another. Every route but `/health`, `/api/vitals` and the static art sits inside
`authenticate(CLERK_AUTH)` (Routing.kt). Every handler takes the Clerk subject from the JWT and
every read is scoped by it, one of two ways:

- Scoped in the query. `partiesFor(userId)`, `weeklyClearsFor(userId)`, `allLootFor(userId)`,
  `findParty(partyId, userId)`, `findOwnedCharacter(characterId, userId)`.
- Gated before an id-keyed query runs. `lootFor(partyId)` and `seatsWithLootHistory(partyId)`
  take no user, so every handler that reaches them proves `ownsParty(partyId, userId)` first.
  LootRoutes.kt says so in a header comment, and does it in all six handlers.

So the fear names a leak that does not exist. That is worth being exact about, because it changes
what the fix is: nobody can see your account, and nobody has been told that.

**To us: a fair amount.** Characters (IGN, level, job, world, sprite URL), item counts per
character, boss clears per week, which bosses each character skips, party configs (which of your
characters runs which boss with whom), logged drops and what they sold for, and the people list.

**Not to us: the screenshot.** It is parsed in memory and dropped. V3 removed `storage_key`
because there was nothing to put in it, and there is no object storage in the stack.
`raw_parse_result` holds grid coordinates, template match scores and digit reads, not the picture.
The only image that touches a disk is a per-line crop handed to Tesseract, into a
`NamedTemporaryFile` in planner.py and a `TemporaryDirectory` in hud.py, both removed when the
`with` block exits.

That is the strongest fact we have and no user is currently told it. An inventory tracker that
never keeps the inventory screenshot is unusual, and "we never store your screenshots" is a
sentence a competitor cannot copy without changing their architecture.

**Outbound.** Two flows leave the box, both carrying an IGN:

- The character name goes to Nexon's public no-auth ranking endpoint to get level, job and sprite
  (NexonLookupService.kt). That endpoint is public and Nexon already owns the data, so nothing is
  revealed that a stranger could not look up. Worth stating anyway.
- The sprite URL Nexon returns is hot-linked straight into `<img src>` (character-tile.tsx,
  roster-strip.tsx, boss-matrix.tsx, character-picker.tsx, user-avatar.tsx). So the *viewer's*
  browser fetches it from Nexon, with our referer, on every page that draws a roster.

**Logs.** Clean, and worth keeping that way. Timing.kt logs method, route and duration.
VitalsRoutes.kt is anonymous by construction and drops any field it does not recognise. The vision
service logs stage timings, image dimensions and item names, never the HUD name it just read.

## Three different features are hiding in one phrase

"Privacy mode" as asked covers three problems with almost nothing in common. Building one and
calling it done would leave the other two, and they are not equally urgent.

### 1. Say what we keep

The turnoff is trust, and no toggle produces trust. There is currently no privacy policy, no data
page, and no way to find out what the site holds short of reading this repo.

What is missing beyond the page itself:

- **No account delete.** Characters, parties and loot each delete individually. The account does
  not. There is no `DELETE /api/account`.
- **Deleting the Clerk account orphans everything.** We handle no Clerk webhooks (`user.deleted`
  included, there is no handler in `backend/src`, only the SDK types in node_modules). Delete
  yourself in Clerk's profile modal and every row stays, keyed to a user id nobody can sign in as,
  including your friends' names. This is the gap that would make any privacy claim we publish
  false.
- **No export.** Less urgent, and cheap once a delete exists, since both walk the same graph.

This is the highest-leverage lane and the least interesting to build.

### 2. Streamer mode

The concrete thing a user can point at. MapleStory players stream, screen-share and post
screenshots in Discord, and that is how this data actually escapes: not through our database,
through their own capture. A client-side toggle that masks IGNs and the people list, leaving counts
and clears alone, needs no schema and no backend.

**The trap: masking the name while drawing the sprite is not a mask.** A sprite is that character's
own gear, hair and cape. Anyone in the party recognises it instantly, and the whole roster is
drawn as sprites. A mode that blanks the text and leaves the art is exactly the plausible,
confident, wrong answer this repo exists to avoid: the user believes they are hidden and they are
not. Masking has to cover the sprite too, which means a placeholder silhouette, and that is a real
design question rather than a string function.

Second detail, smaller: the account avatar falls back to `user.imageUrl`, the OAuth photo, until a
main character is picked. On a stream that is a real face.

Roughly twenty components render a name or a sprite, so this wants one display-layer helper and one
context, not twenty ternaries.

### 3. Peer privacy, for a sharing surface that does not exist yet

Nothing is shared today, but the features already built lean toward it. A drop split, a wallet and
a settle-up are all things you do *with* five other people who currently cannot see any of it. The
first "send this to my party" request is coming.

Whenever it lands, one row should never go through it. `person.name` is the only data in this
database about somebody who is not a user, and it was entered by their friend without asking them:
a real first name tied to their IGNs. "CreedBratton is Chris's" is precisely what nobody wants
published, and we hold it for people who never agreed to anything. It belongs to its owner's
account and should not be shareable, exportable to a party link, or joinable from a shared view,
even when the seats around it are.

## What I would do, in order

1. **A data page, an account delete, and a `user.deleted` webhook.** The page can say the good
   thing honestly only once the delete is real. Small, unglamorous, and the only lane that
   addresses the stated objection (signups).
2. **Streamer mode, sprites included.** Client-only, one helper, one toggle. Needs a decision on
   what a masked character looks like before any code.
3. **Write the sharing rule down now, while there is no sharing to retrofit.** Per-object opt-in,
   and `person` never leaves the account that owns it.

Not recommended: a server-side "private account" flag. There is nothing for it to switch off,
since nothing is public, and a flag that gates a code path nobody can reach is a claim we would
have to keep true forever without a test that can fail.
