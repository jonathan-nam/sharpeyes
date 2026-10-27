<!-- docs/sharpeyes-mark.png is a 4x nearest-neighbour upscale of frontend/app/icon.png.
     Regenerate it the same way if the mark changes, or the README stops matching the app. -->
<p align="center">
  <img src="docs/sharpeyes-mark.png" width="128" alt="">
</p>

<h1 align="center">SharpEyes</h1>

<p align="center"><em>A greater view of your whole MapleStory account.</em></p>

The game shows you one character at a time, and a boss night is settled afterwards from memory.
SharpEyes holds the week for the whole account: what each character cleared, who you ran it with,
what fell, and who is owed what.

## Bossing

- **Boss Matrix.** Every character against every boss for the week, ticked as they clear.
  Bosses a character does not run stop counting towards the week.
- **Party View.** The same week by party: who you ran each boss with, at what difficulty, and what
  each seat is entitled to. Earlier weeks are read-only.
- **Run Order.** Who is around tonight and how long you have, in, out for time, and cannot be
  scheduled. Copies as text.
- **Drop Log.** Four stages in one direction: what fell, what you sold, what that leaves owed, and
  what is settled. A share is stated in mesos where it can be sold, and in pieces where it cannot.
- **Drop Splitter.** A GMS Reg Server split, from the listed price or from what landed.

## Items

- **Characters.** Add by name. Level, job, world and sprite are looked up for you.
- **Inventory.** 31 tracked items, counted per character.
- **Search.** Who is holding what, how many, and what each can redeem now. Eternal pieces count per
  character, never pooled and never mixed.

Running it yourself: `.devcontainer/README.md`.

## Not a Nexon product

SharpEyes is an unofficial fan project. It is **not affiliated with, endorsed by, or sponsored by
Nexon**. MapleStory and all game assets are the property of Nexon.

It ships some of the game's art so that what it shows you looks like what you saw: boss portraits,
item and drop icons, and the inventory count digits. Those are used to identify what the game
already showed you, and they remain Nexon's. The project is free, carries no advertising, and is
not sold.
