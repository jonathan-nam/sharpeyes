import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { dropIconUrls } from "./drop-icons";
import type { BossDrop, DropTables } from "@/types/drop";

const drop = (dropKey: string, iconUrl: string | null): BossDrop => ({
  dropKey,
  name: dropKey,
  iconUrl,
  perMember: null,
  worlds: null,
  quantity: 1,
  fungible: true,
  pieces: {},
  bundles: {},
});

describe("dropIconUrls", () => {
  it("names one URL for a drop on two bosses' tables", () => {
    const tables: DropTables = {
      lotus: [drop("grindstone", "/drop-icons/g.png")],
      damien: [drop("grindstone", "/drop-icons/g.png"), drop("whisper", "/drop-icons/w.png")],
    };
    expect(dropIconUrls(tables)).toEqual(["/drop-icons/g.png", "/drop-icons/w.png"]);
  });

  it("skips the drops the pinned dataset has no art for, rather than warming a null", () => {
    expect(dropIconUrls({ kalos: [drop("a", null), drop("b", "/drop-icons/b.png")] })).toEqual([
      "/drop-icons/b.png",
    ]);
  });

  it("is empty before the tables land, so the caller warms nothing", () => {
    expect(dropIconUrls({})).toEqual([]);
  });
});

// A guard against the mistake rather than the mistake, the same shape as drop-log-callers.test.ts:
// the warm has to be asked for per page, and a page that hands a drop table to a picker without it
// is a picker that paints empty frames on first open. Nothing about the types says so.
const root = join(__dirname, "..");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !name.includes(".test.") ? [path] : [];
  });
}

describe("every page that can record a drop warms its icons", () => {
  // Derived, not listed: which components carry the picker is a fact about the imports, and a list
  // here would be a second one to keep in step.
  const carriers = sources(join(root, "components"))
    .filter((file) => /from "@\/components\/drop-picker"/.test(readFileSync(file, "utf8")))
    .map(
      (file) =>
        `@/components/${file.slice(join(root, "components").length + 1).replace(/\.tsx?$/, "")}`,
    );

  const pages = sources(join(root, "app"))
    .map((file) => ({ file: file.slice(root.length + 1), text: readFileSync(file, "utf8") }))
    .filter((p) => carriers.some((c) => p.text.includes(`"${c}"`)));

  it("finds the pickers and the pages at all, so the guard cannot pass by finding none", () => {
    expect(carriers.length).toBeGreaterThanOrEqual(4);
    expect(pages.length).toBeGreaterThanOrEqual(4);
  });

  it.each(pages)("warms them in $file", ({ text }) => {
    expect(text).toMatch(/useDropIcons\(/);
  });
});
