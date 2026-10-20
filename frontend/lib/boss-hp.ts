// GENERATED FROM catalog/bosses.yaml. DO NOT EDIT BY HAND.
// Regenerate with:  python catalog/build.py
//
// Total HP per boss and difficulty, in trillions, which is what orders bosses hardest first. The
// figures and where they come from are `hp` in bosses.yaml.

export const BOSS_HP: Record<string, Record<string, number>> = {
  lotus: { NORMAL: 1.57, HARD: 33.5, EXTREME: 1810 },
  damien: { NORMAL: 1.2, HARD: 36 },
  "guardian-angel-slime": { NORMAL: 5, CHAOS: 90 },
  lucid: { EASY: 12, NORMAL: 24, HARD: 117.6 },
  will: { EASY: 16.8, NORMAL: 25.2, HARD: 126 },
  gloom: { NORMAL: 25.5, CHAOS: 127.5 },
  "verus-hilla": { NORMAL: 88, HARD: 176 },
  darknell: { NORMAL: 26, HARD: 157.5 },
  "chosen-seren": { NORMAL: 208, HARD: 483, EXTREME: 6480 },
  "kalos-the-guardian": { EASY: 357, NORMAL: 1060, CHAOS: 5120, EXTREME: 21570 },
  "first-adversary": { EASY: 571.09, NORMAL: 1640, HARD: 10590, EXTREME: 33560 },
  kaling: { EASY: 921, NORMAL: 3930, HARD: 11840, EXTREME: 54590 },
  "malefic-star": { NORMAL: 3260, HARD: 14700 },
  limbo: { NORMAL: 6480, HARD: 12550 },
  baldrix: { NORMAL: 9060, HARD: 20340 },
  jupiter: { NORMAL: 10260, HARD: 49400 },
  "black-mage": { HARD: 472.5, EXTREME: 4810 },
};
