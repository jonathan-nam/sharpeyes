import { describe, expect, it } from "vitest";
import { queryParam, withQuery } from "./url-state";

describe("view state in the query string", () => {
  it("reads a param only when it is one of the allowed values", () => {
    expect(queryParam("?tab=etc", "tab", ["use", "etc"])).toBe("etc");
    expect(queryParam("?tab=nope", "tab", ["use", "etc"])).toBeUndefined();
    expect(queryParam("", "tab", ["use", "etc"])).toBeUndefined();
  });

  it("sets one param and keeps the others", () => {
    expect(withQuery("http://x/bosses/split?method=lazy", { commas: "on" })).toBe(
      "/bosses/split?method=lazy&commas=on",
    );
  });

  it("removes a param set to null, leaving a plain path when none are left", () => {
    expect(withQuery("http://x/bosses/split?method=lazy", { method: null })).toBe("/bosses/split");
  });

  it("keeps the hash", () => {
    expect(withQuery("http://x/inventory#top", { tab: "etc" })).toBe("/inventory?tab=etc#top");
  });
});
