import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { PAGE_WAITING, PAGE_WAITING_SHAPED } from "@/components/route-loading";

// Every page is one column wide, set once by --measure. A page whose root is not .page, or a
// loading boundary that is not, draws at a different width from the rest and from its own header.

const app = join(__dirname, "..", "app");
const css = readFileSync(join(app, "globals.css"), "utf8");

function files(dir: string, name: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return files(path, name);
    return e.name === name ? [path] : [];
  });
}

const pages = files(app, "page.tsx");
const loadings = files(app, "loading.tsx");

/** Source without comments, which mention <main> in prose. */
function code(path: string): string {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function maxWidth(selector: string): string | undefined {
  const body = css.match(new RegExp(`(?:^|\\n)\\${selector}\\s*\\{([^}]*)\\}`))?.[1];
  return body?.match(/max-width:\s*([^;]+);/)?.[1]?.trim();
}

describe("the page column", () => {
  it("finds the routes", () => {
    // A glob that silently matched nothing would pass every check below.
    expect(pages.length).toBeGreaterThan(15);
    expect(loadings.length).toBeGreaterThan(10);
  });

  it.each(pages.map((p) => [relative(app, p), p]))("%s renders its <main> as .page", (_, path) => {
    const source = code(path);
    // A redirect has nothing to lay out.
    if (/^\s*redirect\(/m.test(source) && !source.includes("<main")) return;
    const mains = source.match(/<main\b[^>]*>/g) ?? [];
    expect(mains.length).toBeGreaterThan(0);
    for (const main of mains)
      expect(main).toMatch(/^<main className="page">$|^<main className="page" \/>$/);
  });

  it.each(loadings.map((p) => [relative(app, p), p]))("%s loads inside RouteLoading", (_, path) => {
    const source = code(path);
    expect(source).toMatch(/<RouteLoading\b/);
    expect(source).not.toMatch(/<main\b/);
  });

  it("gives RouteLoading the same column", () => {
    expect(PAGE_WAITING.split(" ")).toContain("page");
    expect(PAGE_WAITING_SHAPED.split(" ")).toContain("page");
  });

  it("sets the page, the header and the footer from one width", () => {
    expect(css).toMatch(/--measure:\s*\d+px;/);
    expect(maxWidth(".page")).toBe("var(--measure)");
    expect(maxWidth(".site-header-inner")).toBe("var(--measure)");
    expect(maxWidth(".site-footer")).toBe("var(--measure)");
  });
});
