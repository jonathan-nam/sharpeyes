import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { committedGolden, seeded } from "@/lib/golden";
import { goldenAccount } from "@/lib/golden-pages";
import { goldenJson } from "@/lib/golden-json";
import { recorded, recording, resetRecording } from "@/lib/golden-record";
import { dropLogFigures } from "@/lib/money-figures";
import type { DropLogPage, SharedBook } from "@/types/page";

// The Drop Log's figures, recorded for the backend port. See docs/backend-arithmetic-plan.md.
//
// Runs lib/money-figures.ts, the money app/bosses/drops/page.tsx and its cards draw, over every page in the corpus
// and seeded mutations of each. Writes one entry fixture per page (the whole answer) and one fixture
// per module (what the others asked it, recorded at the module boundary by the mocks below).
//
// The corpus in the repo is invented (lib/golden-pages.ts). MONEY_PAGES_DIR runs an audit over real
// pages instead, writing to MONEY_GOLDEN_OUT and never to the repo.

const { record } = vi.hoisted(() => ({
  record: (name: string) => async (load: () => Promise<Record<string, unknown>>) =>
    (await import("@/lib/golden-record")).wrapModule(name, await load()),
}));
vi.mock("@/lib/piece-ledger", (load) => record("piece-ledger")(load));
vi.mock("@/lib/drop-split", (load) => record("drop-split")(load));
vi.mock("@/lib/loot", (load) => record("loot")(load));
vi.mock("@/lib/money", (load) => record("money")(load));
vi.mock("@/lib/wallet", (load) => record("wallet")(load));
vi.mock("@/lib/vestige-ledger", (load) => record("vestige-ledger")(load));
vi.mock("@/lib/ledger-fates", (load) => record("ledger-fates")(load));
vi.mock("@/lib/settlement", (load) => record("settlement")(load));
vi.mock("@/lib/boss-difficulty", (load) => record("boss-difficulty")(load));

const REPO = new URL("../../backend/money/src/jvmTest/resources/money-golden/", import.meta.url)
  .pathname;
const AUDIT = process.env.MONEY_PAGES_DIR;
const PAGES = AUDIT ?? "";

type Case = { name: string; page: DropLogPage; books: SharedBook[] };

/** Invented accounts (lib/golden-pages.ts), each read by its owner and by its linked member. */
const ACCOUNTS = 12;

function corpus(): Case[] {
  if (!AUDIT)
    return Array.from({ length: ACCOUNTS }, (_, i) => goldenAccount(i + 1)).flatMap((a, i) => [
      { name: `owner-${i + 1}`, page: a.page, books: [] },
      { name: `member-${i + 1}`, page: a.member, books: a.books },
    ]);
  const files = readdirSync(PAGES)
    .filter((f) => f.endsWith(".page.json"))
    .sort();
  return files.map((file) => {
    const name = file.replace(/\.page\.json$/, "");
    const books = (() => {
      try {
        return JSON.parse(readFileSync(`${PAGES}/${name}.books.json`, "utf8")) as SharedBook[];
      } catch {
        return [];
      }
    })();
    return {
      name,
      page: JSON.parse(readFileSync(`${PAGES}/${file}`, "utf8")) as DropLogPage,
      books,
    };
  });
}

/**
 * A variant of one page: rows dropped, sales unmade, amounts and paid flags moved. Not a page anybody
 * had, which is the point: every branch the real one never reached, with the real one's shape.
 */
function mutate<T>(doc: T, random: () => number): T {
  const copy = structuredClone(doc) as Record<string, unknown>;
  const thin = (list: unknown) => (Array.isArray(list) ? list.filter(() => random() > 0.25) : list);
  for (const key of ["tranches", "payments", "settlements", "debts", "disposals"])
    if (key in copy) copy[key] = thin(copy[key]);
  const pools = (copy.pools ?? []) as { loot: Record<string, unknown>[] }[];
  for (const pool of pools)
    for (const loot of pool.loot) {
      const roll = random();
      if (roll < 0.1) {
        loot.saleAmount = null;
        loot.saleUsdCents = null;
      } else if (roll < 0.25 && typeof loot.saleAmount === "number") {
        loot.saleAmount = Math.round(loot.saleAmount * (0.5 + random()));
      }
      for (const payout of (loot.payouts ?? []) as { paid: boolean }[])
        if (random() < 0.15) payout.paid = !payout.paid;
    }
  for (const key of ["tranches", "payments", "debts", "disposals"])
    for (const row of (copy[key] ?? []) as { amount?: number | null }[])
      if (typeof row.amount === "number" && random() < 0.2)
        row.amount = Math.round(row.amount * (0.5 + random()));
  return copy as T;
}

const MUTATIONS = AUDIT ? Number(process.env.MONEY_MUTATIONS ?? 200) : 25;

describe("money golden fixtures", () => {
  it(
    "are what the Drop Log's figures and their modules answer today",
    () => {
      // An audit's real pages are large, so it keeps fewer and bigger calls, and writes each variant to
      // its own file as it goes: nothing waits in memory for the next.
      if (AUDIT) resetRecording(60, 300_000);
      else resetRecording(50, 12_000);
      const out = AUDIT ? process.env.MONEY_GOLDEN_OUT! : REPO;
      if (AUDIT) mkdirSync(out, { recursive: true });

      const texts = new Map<string, string>();
      for (const c of corpus()) {
        const random = seeded(c.name.length * 7919 + 1);
        for (let i = 0; i <= MUTATIONS; i += 1) {
          const page = i === 0 ? c.page : mutate(c.page, random);
          const books = i === 0 ? c.books : c.books.map((b) => mutate(b, random));
          const output = recording(() => goldenJson(dropLogFigures(page, books)));
          const entry = `{"cases":[\n${JSON.stringify({ input: { page, books }, output })}\n]}\n`;
          if (AUDIT) writeFileSync(`${out}/entry-${c.name}-${i}.json`, entry);
          else if (i === 0) texts.set(`entry-${c.name}.json`, entry);
        }
      }
      // One file per function, so no module's fixture outgrows the repo's file size limit.
      for (const [fn, calls] of recorded()) {
        texts.set(`module-${fn}.json`, `{${JSON.stringify(fn)}:${JSON.stringify(calls)}}\n`);
      }

      for (const [name, text] of texts) {
        if (AUDIT) writeFileSync(`${out}/${name}`, text);
        else
          expect(committedGolden(name, text) === text, `${name}: run with UPDATE_GOLDEN=1`).toBe(
            true,
          );
      }
      // An audit runs for minutes over real pages, and must not be retried half written.
    },
    { timeout: AUDIT ? 3_600_000 : undefined, retry: AUDIT ? 0 : undefined },
  );
});
