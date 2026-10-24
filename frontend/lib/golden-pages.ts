import { seeded } from "@/lib/golden";
import type { Boss } from "@/types/boss";
import type { DropTables } from "@/types/drop";
import type { Loot, PartyLootPool } from "@/types/loot";
import type { DropLogPage, SharedBook } from "@/types/page";
import type { Party, PartyMember, Person } from "@/types/party";
import type {
  ProceedsDisposal,
  SettlementDebt,
  VestigePayment,
  VestigeSettlement,
  VestigeTranche,
} from "@/types/vestige";
import type { Holder } from "@/lib/vestige-ledger";

// Invented Drop Log accounts for the money golden fixtures (lib/money.golden.test.ts). Seeded, so the
// same seed is the same account. Nothing here is anybody's data: real pages are audited outside the
// repo instead.

const VESTIGE = "vestige-of-erion";

/** A few bosses in catalog order, and the coupon that drops in bundles. Shaped like the real catalog. */
export const BOSSES: Boss[] = [
  ["lotus", "Lotus", ["NORMAL", "HARD", "EXTREME"]],
  ["damien", "Damien", ["NORMAL", "HARD"]],
  ["kalos", "Kalos the Guardian", ["EASY", "NORMAL", "CHAOS", "EXTREME"]],
  ["malefic-star", "Malefic Star", ["NORMAL", "HARD"]],
  ["chosen-seren", "Chosen Seren", ["NORMAL", "HARD", "EXTREME"]],
].map(([bossKey, name, difficulties]) => ({
  bossKey: bossKey as string,
  name: name as string,
  reset: "WEEKLY",
  iconUrl: `/boss-icons/${bossKey as string}.png`,
  difficulties: difficulties as string[],
  pieces: [],
}));

const ITEMS = [
  "eternal-armor-box",
  "grindstone-of-life",
  "exceptional-hammer",
  "pitch-black-heart",
];

export const DROPS: DropTables = Object.fromEntries(
  BOSSES.map((boss) => [
    boss.bossKey,
    [
      ...ITEMS.map((dropKey) => ({
        dropKey,
        name: dropKey.replace(/-/g, " "),
        iconUrl: `/drop-icons/${dropKey}.png`,
        perMember: null,
        worlds: null,
        quantity: 1,
        fungible: dropKey === "grindstone-of-life",
        pieces: {},
        bundles: {},
      })),
      {
        dropKey: VESTIGE,
        name: "Vestige of Erion Coupon",
        iconUrl: `/drop-icons/${VESTIGE}.png`,
        perMember: "HEROIC",
        worlds: null,
        quantity: 1,
        fungible: false,
        pieces: { INTERACTIVE: { HARD: 30, EXTREME: 30 } },
        bundles: { INTERACTIVE: { HARD: 3, EXTREME: 6 } },
      },
    ],
  ]),
);

const FIRST = [
  "Thornwick",
  "Pellmoor",
  "Ashgrove",
  "Vintry",
  "Corrow",
  "Elsmere",
  "Brackley",
  "Dunholt",
];

/** One invented account and, for its first linked person, the book that person reads. */
export function goldenAccount(seed: number): {
  page: DropLogPage;
  books: SharedBook[];
  member: DropLogPage;
} {
  const random = seeded(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(random() * (hi - lo + 1));
  const pick = <T>(list: readonly T[]) => list[Math.floor(random() * list.length)]!;
  const chance = (p: number) => random() < p;
  let counter = 0;
  const id = () => {
    counter += 1;
    const hex = (seed * 1_000_003 + counter).toString(16).padStart(12, "0").slice(-12);
    return `${hex.slice(0, 8)}-0000-4000-8000-${hex}`;
  };
  // Thursdays, a week apart, the way a weekly boss resets.
  const weeks = Array.from({ length: int(3, 8) }, (_, i) =>
    new Date(Date.UTC(2026, 6, 2) + i * 7 * 86_400_000).toISOString().slice(0, 10),
  );
  const day = (week: string, plus: number) =>
    new Date(Date.parse(`${week}T00:00:00Z`) + plus * 86_400_000).toISOString().slice(0, 10);
  let clock = Date.UTC(2026, 6, 2);
  const stamp = () => {
    clock += int(1, 90) * 60_000 + int(0, 999);
    return new Date(clock).toISOString();
  };

  const own = Array.from({ length: int(1, 3) }, (_, i) => ({
    id: id(),
    name: `${pick(FIRST)}${i}`,
  }));
  const people: Person[] = Array.from({ length: int(1, 4) }, (_, i) => {
    const name = `${FIRST[(i + seed) % FIRST.length]}`;
    return {
      id: id(),
      name,
      characters: [`${name}Alt`, `${name}Main`].slice(0, int(1, 2)),
      ownedCharacters: [],
      linked: i === 0 || chance(0.3),
      pinned: chance(0.3),
    };
  });
  const strangers = ["Quillon", "Marrowby"].slice(0, int(0, 2));

  const seat = (fields: Partial<PartyMember>): PartyMember => ({
    id: id(),
    name: "",
    personId: null,
    personName: null,
    characterId: null,
    linkedCharacterId: null,
    spriteImgUrl: null,
    guest: false,
    shares: chance(0.15) ? 2 : 1,
    pieceShares: chance(0.15) ? 2 : 1,
    ...fields,
  });

  const parties: Party[] = [];
  const pools: PartyLootPool[] = [];
  for (let p = 0; p < int(2, 6); p += 1) {
    const boss = pick(BOSSES);
    const mine = pick(own);
    const solo = chance(0.15);
    const seats = [seat({ name: mine.name, characterId: mine.id })];
    if (!solo) {
      for (const person of people)
        if (chance(0.6))
          seats.push(
            seat({
              name: person.characters[0]!,
              personId: person.id,
              personName: person.name,
              linkedCharacterId: person.linked ? id() : null,
            }),
          );
      for (const stranger of strangers) if (chance(0.4)) seats.push(seat({ name: stranger }));
      if (seats.length === 1)
        seats.push(
          seat({
            name: people[0]!.characters[0]!,
            personId: people[0]!.id,
            personName: people[0]!.name,
          }),
        );
    }
    const difficulty = pick(
      boss.difficulties
        .filter((d) => ["HARD", "EXTREME"].includes(d))
        .concat(boss.difficulties.slice(0, 1)),
    );
    const party: Party = {
      id: id(),
      slug: `${boss.bossKey}-${p}`,
      characterId: mine.id,
      solo: seats.length === 1,
      oneOff: false,
      retired: chance(0.1),
      worldType: "INTERACTIVE",
      bossKey: boss.bossKey,
      difficulty,
      weekDifficulty: null,
      minutes: null,
      members: seats,
      seats,
      usualRoster: true,
      skippedThisPeriod: false,
      ranAsParty: seats.length > 1,
      pendingLoot: 0,
      awaitingPayout: 0,
      settledLoot: 0,
      cleared: null,
      clearedByHand: false,
      yours: true,
      createdAt: stamp(),
      updatedAt: stamp(),
    };
    parties.push(party);

    const loot: Loot[] = [];
    for (const week of weeks) {
      if (chance(0.25)) continue;
      const ran = seats.filter((s, i) => i === 0 || chance(0.85));
      const ranIds = ran.map((s) => s.id);
      const base = (dropKey: string, quantity: number): Loot => ({
        id: id(),
        dropKey,
        customName: null,
        name: dropKey === VESTIGE ? "Vestige of Erion Coupon" : dropKey.replace(/-/g, " "),
        iconUrl: `/drop-icons/${dropKey}.png`,
        perMember: dropKey === VESTIGE ? "HEROIC" : null,
        bossKey: boss.bossKey,
        quantity,
        difficulty,
        droppedOn: day(week, int(0, 6)),
        weekStart: week,
        status: "PENDING",
        saleAmount: null,
        saleUsdCents: null,
        amountBasis: null,
        splitMethod: null,
        sellerShares: null,
        sellerMemberId: null,
        takenByMemberId: null,
        solo: party.solo,
        soldAt: null,
        recordedAt: stamp(),
        recordedByYou: true,
        recordedByName: null,
        payouts: [],
        ranThatWeek: ranIds,
        sharesThatWeek: chance(0.1) ? { [ranIds[0]!]: 2 } : {},
        bundles: null,
        bundlesBy: [],
      });
      // Coupons, looted in bundles that rarely divide by the party.
      if (difficulty === "HARD" || difficulty === "EXTREME") {
        const bundles = difficulty === "EXTREME" ? 6 : 3;
        const coupon = base(VESTIGE, bundles * 30);
        coupon.bundles = bundles;
        const counts = new Map<string, number>();
        for (let b = 0; b < bundles; b += 1) {
          const who = chance(0.5) ? ran[0]!.id : pick(ran).id;
          counts.set(who, (counts.get(who) ?? 0) + 1);
        }
        coupon.bundlesBy = [...counts].map(([memberId, n]) => ({ memberId, bundles: n }));
        loot.push(coupon);
      }
      for (let n = 0; n < int(0, 2); n += 1) {
        const drop = base(pick(ITEMS), 1);
        const roll = random();
        if (roll < 0.15 && ran.length > 0) {
          drop.takenByMemberId = pick(ran).id;
          drop.status = "TAKEN";
        } else if (roll < 0.8) {
          const seller = chance(0.7) ? ran[0]! : pick(ran);
          const dollars = chance(0.08);
          drop.saleAmount = dollars ? null : int(1, 400) * 10_000_000 + int(0, 9_999_999);
          drop.saleUsdCents = dollars ? int(1_000, 200_000) : null;
          drop.amountBasis = pick(["LISTED", "RECEIVED", "BOUGHT"]);
          drop.splitMethod = chance(0.85) ? "FAIR" : "LAZY";
          drop.sellerMemberId = seller.id;
          drop.sellerShares = seller.shares;
          drop.soldAt = stamp();
          drop.payouts = ran
            .filter((s) => s.id !== seller.id)
            .map((s) => {
              const paid = chance(0.45);
              return { memberId: s.id, paid, paidAt: paid ? stamp() : null, shares: s.shares };
            });
          drop.status = drop.payouts.every((x) => x.paid) ? "PAID_OUT" : "SOLD";
        }
        loot.push(drop);
      }
    }
    pools.push({ partyId: party.id, loot });
  }

  const personHolder = (person: Person): Holder => ({
    kind: "PERSON",
    personId: person.id,
    characterName: null,
  });
  const holders: Holder[] = [
    ...people.map(personHolder),
    ...strangers.map((s) => ({
      kind: "CHARACTER" as const,
      personId: null,
      characterName: s.toLowerCase(),
    })),
  ];
  const SELF: Holder = { kind: "SELF", personId: null, characterName: null };
  const allLoot = pools.flatMap((pool) => pool.loot);
  const coupons = allLoot.filter((l) => l.dropKey === VESTIGE);
  const sold = allLoot.filter((l) => l.saleAmount !== null && l.payouts.length > 0);

  const tranches: VestigeTranche[] = Array.from(
    { length: coupons.length > 0 ? int(0, 6) : 0 },
    () => {
      const holder = chance(0.6) ? SELF : pick(holders);
      const pieces = int(1, 12) * 10;
      const disposition = pick(["SOLD", "SOLD", "SOLD", "KEPT", "BOUGHT"] as const);
      const creditor = pick(holders);
      return {
        id: id(),
        holder,
        pieces,
        amount: disposition === "KEPT" ? null : pieces * int(15, 25) * 1_000_000,
        disposition,
        shares: chance(0.7)
          ? [
              {
                holder: holder.kind === "SELF" ? creditor : SELF,
                pieces: Math.min(pieces, int(1, 9) * 10),
              },
            ]
          : [],
        soldAt: stamp(),
        recordedByYou: true,
        recordedByName: null,
      };
    },
  );
  const payments: VestigePayment[] = Array.from({ length: int(0, 3) }, () => ({
    id: id(),
    holder: pick(holders),
    amount: int(1, 90) * 100_000_000,
    note: null,
    receivedAt: stamp(),
    recordedByYou: true,
    recordedByName: null,
  }));
  const settlements: VestigeSettlement[] =
    coupons.length > 0 && chance(0.4)
      ? [
          {
            id: id(),
            holder: pick(holders),
            lootIds: [pick(coupons).id],
            unpaid: chance(0.5) ? 0 : int(1, 60),
            settledAt: stamp(),
          },
        ]
      : [];
  const debts: SettlementDebt[] = [
    ...Array.from({ length: int(0, 3) }, () => ({
      id: id(),
      holder: pick(holders),
      amount: (chance(0.6) ? 1 : -1) * int(1, 200) * 10_000_000,
      note: null,
      payouts: [],
      incurredAt: stamp(),
      recordedByYou: true,
      recordedByName: null,
    })),
    // Offsets naming a share, the shape Offset writes: one row per share, negative.
    ...sold
      .filter(() => chance(0.15))
      .flatMap((loot) => {
        const payout = pick(loot.payouts);
        const seatOf = parties.flatMap((p) => p.seats).find((s) => s.id === payout.memberId);
        const person = people.find((x) => x.id === seatOf?.personId);
        if (!person) return [];
        return [
          {
            id: id(),
            holder: personHolder(person),
            amount: -int(1, 300) * 1_000_000,
            note: null,
            payouts: [{ lootId: loot.id, memberId: payout.memberId }],
            incurredAt: stamp(),
            recordedByYou: true,
            recordedByName: null,
          },
        ];
      }),
  ];
  const disposals: ProceedsDisposal[] = Array.from(
    { length: tranches.length > 0 ? int(0, 2) : 0 },
    () => ({
      id: id(),
      holder: pick(holders),
      amount: int(1, 40) * 100_000_000,
      kind: pick(["OFFSET", "PAID"] as const),
      decidedAt: stamp(),
      heldBy: pick(["YOU", "THEM"] as const),
      recordedByYou: true,
      recordedByName: null,
    }),
  );

  const page: DropLogPage = {
    parties,
    pools,
    tranches,
    payments,
    settlements,
    debts,
    disposals,
    bosses: BOSSES,
    drops: DROPS,
    characters: [],
    people,
  };

  // The linked person's side: their own small account, and the owner's book read as theirs.
  const reader = people.find((p) => p.linked)!;
  const book: SharedBook = {
    ownerName: own[0]!.name,
    personId: reader.id,
    ownerPersonId: id(),
    parties: parties.filter((p) => p.seats.some((s) => s.personId === reader.id)),
    pools: pools.filter((pool) =>
      parties.some((p) => p.id === pool.partyId && p.seats.some((s) => s.personId === reader.id)),
    ),
    tranches,
    payments,
    settlements,
    debts: debts.filter((d) => d.holder.personId === reader.id),
    disposals: disposals.filter((d) => d.holder.personId === reader.id),
  };
  const member: DropLogPage = {
    ...page,
    parties: [],
    pools: [],
    tranches: [],
    payments: [],
    settlements: [],
    debts: [],
    disposals: [],
    people: [],
  };
  return { page, books: [book], member };
}
