// GENERATED FROM catalog/bosses.yaml. DO NOT EDIT BY HAND.
// Regenerate with:  python catalog/build.py
//
// What is known before a USER is, which is the whole reason these are shipped in the bundle
// rather than read off /api/bosses.
//
// BOSS_ART is backend-relative portrait paths, resolved with apiAssetUrl() like every other
// served asset. It exists so the browser can start fetching the portraits at first render rather
// than after getToken() and /api/bosses have both answered. That waterfall is what made the art
// appear a beat after the rest of the page.
//
// BOSS_ART_2X is the same portraits at 80px, for the one place that draws them larger than the
// game does (Run Order's 40px row). Use it wherever the box is bigger than 26px; use BOSS_ART
// wherever it is 26px or an exact fraction of it. See vision/app/cv/build_boss_portraits.py.
//
// BOSS_NAMES is the display names, in catalog order. The Run Order tool has to offer a boss list
// with no account behind it, and deriving one from the keys gets "Kalos The Guardian" wrong.
//
// Only tracked bosses in all three, matching what boss_catalog is seeded with.
//
// BOSS_SHORT_NAMES is what a party calls a boss out loud, and holds only the ones that have one.
// A missing key means the full name is the short name. Never match anything against these.
// shared/planning's PlanText.kt holds the same map; boss-night.golden.test.ts fails when they differ.

export const BOSS_ART: Record<string, string> = {
  lotus: "/boss-icons/lotus.png",
  damien: "/boss-icons/damien.png",
  "guardian-angel-slime": "/boss-icons/guardian-angel-slime.png",
  lucid: "/boss-icons/lucid.png",
  will: "/boss-icons/will.png",
  gloom: "/boss-icons/gloom.png",
  "verus-hilla": "/boss-icons/verus-hilla.png",
  darknell: "/boss-icons/darknell.png",
  "chosen-seren": "/boss-icons/chosen-seren.png",
  "kalos-the-guardian": "/boss-icons/kalos-the-guardian.png",
  "first-adversary": "/boss-icons/first-adversary.png",
  kaling: "/boss-icons/kaling.png",
  "malefic-star": "/boss-icons/malefic-star.png",
  limbo: "/boss-icons/limbo.png",
  baldrix: "/boss-icons/baldrix.png",
  jupiter: "/boss-icons/jupiter.png",
  "black-mage": "/boss-icons/black-mage.png",
};

export const BOSS_ART_2X: Record<string, string> = {
  lotus: "/boss-icons/lotus@2x.png",
  damien: "/boss-icons/damien@2x.png",
  "guardian-angel-slime": "/boss-icons/guardian-angel-slime@2x.png",
  lucid: "/boss-icons/lucid@2x.png",
  will: "/boss-icons/will@2x.png",
  gloom: "/boss-icons/gloom@2x.png",
  "verus-hilla": "/boss-icons/verus-hilla@2x.png",
  darknell: "/boss-icons/darknell@2x.png",
  "chosen-seren": "/boss-icons/chosen-seren@2x.png",
  "kalos-the-guardian": "/boss-icons/kalos-the-guardian@2x.png",
  "first-adversary": "/boss-icons/first-adversary@2x.png",
  kaling: "/boss-icons/kaling@2x.png",
  "malefic-star": "/boss-icons/malefic-star@2x.png",
  limbo: "/boss-icons/limbo@2x.png",
  baldrix: "/boss-icons/baldrix@2x.png",
  jupiter: "/boss-icons/jupiter@2x.png",
  "black-mage": "/boss-icons/black-mage@2x.png",
};

export const BOSS_NAMES: Record<string, string> = {
  lotus: "Lotus",
  damien: "Damien",
  "guardian-angel-slime": "Guardian Angel Slime",
  lucid: "Lucid",
  will: "Will",
  gloom: "Gloom",
  "verus-hilla": "Verus Hilla",
  darknell: "Darknell",
  "chosen-seren": "Chosen Seren",
  "kalos-the-guardian": "Kalos the Guardian",
  "first-adversary": "First Adversary",
  kaling: "Kaling",
  "malefic-star": "Malefic Star",
  limbo: "Limbo",
  baldrix: "Baldrix",
  jupiter: "Jupiter",
  "black-mage": "Black Mage",
};

export const BOSS_SHORT_NAMES: Record<string, string> = {
  "chosen-seren": "Seren",
  "kalos-the-guardian": "Kalos",
  "first-adversary": "Adversary",
  "malefic-star": "Star",
};
