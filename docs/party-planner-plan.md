# Party Planner: permanent parties for many characters at once

Status: phase 1 in progress (planner page, local draft, solver). Phases 2 and 3 are designed here
and not built.

## The problem

Somebody with eight characters, and friends with eight more each, wants every one of them in a
weekly party for the bosses they are working on: Seren and up, plus Extreme Black Mage. Working out
who goes with whom by hand means juggling party caps, who is strong enough to carry whom, who
cannot be in two places at once, and how the loot should divide when the damage does not. Then
everybody has to agree, and only then are the parties made.

## Scope

Chosen Seren, Kalos, First Adversary, Kaling, Malefic Star, Limbo, Baldrix and Jupiter at any mode,
and Black Mage at Extreme only. Tenebris (Gloom, Verus Hilla, Darknell, Hard Black Mage) and
everything below is out. The list is `PLANNER_BOSSES` in `frontend/lib/party-planner.ts`.

## Inputs

**General**

- The characters that need parties: your own, any character of a person on your People page (a
  linked friend's own characters, or names you have filed under somebody who does not use the
  app), and any other IGN typed in. A typed IGN nobody holds is a standalone character, counted as
  its own player, so one person can plan for characters the app has no record of.
- Run Length: a slider from Fastest (runs of at most 10 minutes) to Min Cut (30). It is a hard
  ceiling on any party of two or more. A party that would take longer is not proposed.

**Per character, per boss**

- Boss and difficulty.
- Strength: how much of that boss the character takes off alone in a 30-minute run, from No
  Damage to Solo. Ticks sit at each fraction of the boss's party cap (1/6 to 5/6 for a six-person
  boss, 1/3 and 2/3 for a three-person one) and the slider snaps to a tick within 2 units but can
  rest anywhere. Damage buffs the character gives the party count towards it.
- Largest party: Any Size, or a cap. Destiny Liberation progresses faster in smaller parties.

A Split Preference setting was considered and left out for now. Splits follow strength, below.

## The model

Strength is stored in sixtieths of a solo clear. 60 divides by every party size up to six, so every
tick is a whole number, and a share count built from strengths stays under the seat's 99 cap.

Strengths add. A party summing to 60 is a 30-minute run, to 120 a 15-minute one. This is crude,
and deliberately so: the slider is already a guess, and the whole plan goes to every member for
review before anything is made.

**Hard rules**

1. A character that can solo is planned solo and never carries. Solo clearers keep their whole
   loot over seating a weaker character.
2. Two characters of one person are never in the same run (one account, one client).
3. A party never exceeds the boss's cap (`max_party` in `catalog/bosses.yaml`) or any member's own
   cap.
4. A party of two or more clears within the Run Length.
5. Parties never cross a world or a difficulty.
6. People a reviewer asked to be kept apart are kept apart.

**Ranking**, per (world, boss, difficulty), in order:

1. The most characters placed.
2. The most parties. Each party loots once, so more parties is more loot in total, and it is also
   the smallest parties for Liberation.
3. The smallest largest party.
4. The fewest minutes spent, summed over everyone in each run.

Up to 14 characters on one boss are searched exhaustively (every grouping, 3^14 steps). Above that
the plan is greedy, and the page says so.

**Splits.** Each seat's share count is its strength, divided by what the party's strengths have in
common. A 40 and a 20 split 2:1, and a member doing nothing takes nothing. These are the counts the
party's seats get when it is created (V44 `shares`).

**Unplaced.** A character with no party is listed with why: Can't clear in time (no party it could
be in clears within the Run Length) or No room (one could, but seating it cost more elsewhere).

## Review (phase 2)

The plan's owner sends it for review. Every linked account with a character in it gets a bell
entry and sees the plan on the Party Planner, with its own characters marked. Each answers
**Accept** or **Reject**. A person who does not use the app is answered for by the owner.

**A rejection is a change to the inputs, not a comment.** Each reason names something the solver
already reads, so the owner never has to interpret prose, and the plan can be redone without them:

| Reason | The rejecter gives | What it changes |
|---|---|---|
| My strength is off | one of their characters, and a new strength | that want's `strength` |
| Party too big | one of their characters, and a cap | that want's `maxParty` |
| Runs too long | a run length | a per-person ceiling, read as the lowest in the party |
| Not with this person | a person in the same party | an `apart` pair |
| Wrong difficulty | one of their characters, and a difficulty | that want's `difficulty` |
| Drop this boss | one of their characters | removes that want |
| Other | up to 200 characters | nothing: the plan waits for the owner |

Before a rejection is sent, the rejecter sees the plan it would produce, including anything it
leaves unplaced ("Rune would have no party"). Sending applies the change and re-plans at once.

Every structured reason only tightens the inputs, so the loop ends. Parties whose members did not
change keep the acceptances they had, so a re-plan only goes back to the people it moved.

## Creation (phase 3)

When every account has accepted the current revision, each proposed party becomes an ordinary
party config:

- **Leader.** The linked account whose character has the most shares (they deal the most damage,
  and the logger sells, see `the-logger-sells`). A tie goes to the plan's owner, then to whoever
  leads fewest. A leader has to have a character in the party, because `party.character_id` is the
  owner's own character. A party with nobody on the app in it (all standalone characters, say) is
  not created, and stays in the plan as the answer it is.
- The config is written as the leader's: their character, the boss and mode, the estimated minutes,
  and the strength-based shares.
- **Invites.** Every other linked account's character gets a party invite through #800
  (`party_invite`, `sendInvites`, the `PARTY_INVITE` bell entry). Accepting seats it, as for any
  invite. A character of somebody not on the app, standalone ones included, is written as a plain
  name seat, as today, and its sprite is looked up when the seat is saved.
- **Review.** Only linked accounts are asked. The plan's owner answers for everyone else.
- A character already in a standing party for that boss (#800's `inPartyFor`, and the
  `(character_id, boss)` unique index) is flagged in the draft and blocks sending for review,
  rather than being dropped or replaced at creation.

## Data (phase 2)

Numbered after #800's V92.

```
party_plan          id, owner_user_id, world_type, max_minutes, status (DRAFT|REVIEW|DONE|CANCELLED),
                    revision, created_at, updated_at
party_plan_want     id, plan_id, character_id NULL (owner's own) | person_id NULL (a People row),
                    character_name, boss_catalog_id, difficulty, strength 0..60, max_party NULL,
                    max_minutes NULL
party_plan_apart    plan_id, person_a, person_b
party_plan_revision plan_id, revision, parties jsonb, created_at
party_plan_answer   plan_id, revision, user_id, verdict (ACCEPT|REJECT), created_at
party_plan_reason   answer, kind, want_id NULL, person_id NULL, value int NULL, note NULL
```

The solver stays in TypeScript, as `boss-run-plan.ts` does. The server stores each revision's
output and checks only what it must not trust: every seat is a want of this plan, rules 2, 3 and 5
hold, and nobody's want was dropped.

## Phases

1. **Planner page** (this PR). `/bosses/planner` under a new Utility menu group, beside the Drop
   Splitter (the Split Utility, renamed). Inputs kept in the browser, plan recomputed live.
2. **Plans and review.** Server-side plans, sending for review, Accept and Reject with structured
   reasons, automatic re-plan, bell entries.
3. **Creation.** Leaders, configs, and invites. Needs #800.

## Open questions

- A soloer never carries. Should a soloer be able to opt in to carrying a weaker character?
- The Run Length ceiling applies to parties only. A Solo strength means a solo clear within 30
  minutes, so a soloer is always planned solo whatever the Run Length.
- The world is the account's lens for now (`world: null`). Kronos and Hyperion characters are not
  told apart until wants carry their character's world (phase 2).
