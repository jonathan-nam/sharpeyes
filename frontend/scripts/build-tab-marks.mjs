// The Drop Log's tab marks and the home screen's, as static art.
//
// All of them are the game's own item sprites, trimmed to their art and centred on a square canvas
// that the tab draws 1:1. Nothing here is ever scaled: a sprite bigger than the canvas is an error,
// not something to quietly shrink. Both ways of getting that wrong have now shipped. First a 46px
// canvas was drawn into a 23px box, which halved every mark and made the owl an unreadable 13x16px
// smudge. Then the canvas was 32 while Grindstone of Life's art is 34x33, so it was resampled 0.941x
// and went soft, which is what a fractional scale does to pixel art and is why
// pixel-scaling-css.test.ts refuses it everywhere else.
//
// The grindstone is also a catalog drop, and its id is read from catalog/drops.yaml rather than
// written twice. This file decides the SIZE, the catalog decides WHICH SPRITE.
//
//   pnpm marks
//
// Re-run only to change a mark or bump the dataset. The output is committed, so a normal build and
// a normal CI run never touch the network.
import { createRequire } from "node:module";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const sharp = require("sharp");

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "public", "marks");
const DROPS_YAML = join(HERE, "..", "..", "catalog", "drops.yaml");
const BOSS_ART = join(
  HERE,
  "..",
  "..",
  "backend",
  "src",
  "main",
  "resources",
  "seed-assets",
  "bosses",
);

// catalog/build.py's ICON_VERSION. Pinned, not "latest", for the reason stated there: "latest" is
// whatever got extracted last and can regress an id out from under us. tab-marks.test.ts holds this
// to build.py's.
const ICON_VERSION = 268;

// Not the catalog's 46. A tab mark is drawn at its canvas size, so the canvas IS the drawn size.
// 36 was sized for the boss crystal, since retired. The largest sprite now is Grindstone of Faith
// (33x32), so every one of them sits 1:1. Raising it grows every chip in the strip, so raise it deliberately when a mark needs it,
// and never as a way of making one fit.
const MARK_CANVAS = 36;

const URL_FOR = (id) => `https://maplestory.io/api/GMS/${ICON_VERSION}/item/${id}/icon`;

const MARKS = [
  // What fell. A catalog drop, so its id comes from the catalog. Grindstone of FAITH and not of
  // Life: Life's art is soft glow with no hard edge and reads as a smear at this size, where
  // Faith's white outline survives.
  { key: "grindstone-of-faith", fromCatalog: "grindstone-of-faith" },
  // A sale is in mesos, and this is what mesos look like as a pile rather than a number.
  { key: "money-sack", id: 4031138, name: "Money Sack" },
  // The Free Market search owl: the game's own mark for dealing with another player, which is what
  // a settlement is.
  { key: "owl-of-minerva", id: 2310000, name: "The Owl of Minerva" },
  // The home screen's rows. A character's photo for the characters, a bag for the inventory, a
  // ticked sheet for a week of clears, a leader and followers for the parties, and a route for Run
  // Order. Follow the Lead is a skill, so it comes out of the wz tree, not the item endpoint.
  { key: "roly-poly-photo", id: 4031079, name: "Photo of Roly-Poly 1" },
  { key: "party-quest-bag", id: 4330016, name: "8-slot Party Quest Bag" },
  { key: "attendance-sheet", id: 4032057, name: "Attendance Sheet" },
  {
    key: "follow-the-lead",
    wz: "Skill/_Canvas/000.img/skill/0000008/icon",
    name: "Follow the Lead",
  },
  { key: "treasure-map", id: 3994353, name: "Pirate King's Treasure Map <1st Piece>" },
  // The header's notifications. The plain jingle bell, not the Golden Bell with holly (4001475),
  // which says Christmas before it says bell.
  { key: "golden-bell", id: 4031191, name: "Golden Bell" },
  // The home screen's Bossing row. A boss portrait, so it is cut from a planner capture rather than
  // fetched: see vision/app/cv/build_boss_portraits.py.
  { key: "jupiter", file: join(BOSS_ART, "jupiter.png") },
];

/** The `icon_id` catalog/drops.yaml gives a drop, so this file never states one twice. */
async function catalogIconId(key) {
  const yaml = await readFile(DROPS_YAML, "utf8");
  const block = new RegExp(`- key: ${key}\\n(?:\\s+\\w+:.*\\n)*?\\s+icon_id: (\\d+)`).exec(yaml);
  if (!block) throw new Error(`no icon_id for ${key} in catalog/drops.yaml`);
  return Number(block[1]);
}

/** Trim to the art and centre it. Refuses to scale, which is the whole point of this file. */
async function place(buf, key) {
  const art = await sharp(buf)
    .ensureAlpha()
    .trim({ threshold: 0 })
    .toBuffer({ resolveWithObject: true });
  const { width, height } = art.info;
  if (width > MARK_CANVAS || height > MARK_CANVAS) {
    throw new Error(
      `${key} is ${width}x${height}, larger than MARK_CANVAS ${MARK_CANVAS}. Raise the canvas ` +
        `(every chip in the strip grows with it) rather than letting the art be scaled: a ` +
        `fractional downscale is what made Grindstone of Life soft.`,
    );
  }
  return sharp({
    create: {
      width: MARK_CANVAS,
      height: MARK_CANVAS,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: art.data, gravity: "centre" }])
    .png()
    .toBuffer();
}

await mkdir(OUT, { recursive: true });
for (const mark of MARKS) {
  let id = "file";
  let art;
  if (mark.file) {
    art = await readFile(mark.file);
  } else if (mark.wz) {
    id = mark.wz;
    const res = await fetch(`https://maplestory.io/api/wz/GMS/${ICON_VERSION}/${mark.wz}`);
    if (!res.ok) throw new Error(`${mark.key} (${id}): ${res.status} from the mirror`);
    art = Buffer.from((await res.json()).value, "base64");
  } else {
    id = mark.id ?? (await catalogIconId(mark.fromCatalog));
    const res = await fetch(URL_FOR(id));
    if (!res.ok) throw new Error(`${mark.key} (${id}): ${res.status} from the mirror`);
    art = Buffer.from(await res.arrayBuffer());
  }
  const png = await place(art, mark.key);
  const { width, height } = await sharp(png).metadata();
  if (width !== MARK_CANVAS || height !== MARK_CANVAS) {
    throw new Error(`${mark.key} came out ${width}x${height}, not ${MARK_CANVAS}x${MARK_CANVAS}`);
  }
  await writeFile(join(OUT, `${mark.key}.png`), png);
  console.log(`${mark.key}.png  id ${id}  ${png.length} bytes`);
}
