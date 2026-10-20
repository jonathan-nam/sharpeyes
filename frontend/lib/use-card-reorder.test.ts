import { describe, expect, it } from "vitest";
import { movedTo } from "@/lib/use-card-reorder";

const list = ["a", "b", "c", "d"].map((id) => ({ id }));
const ids = (l: { id: string }[]) => l.map((x) => x.id);

describe("movedTo", () => {
  it("takes the target's place, moving forward or back", () => {
    expect(ids(movedTo(list, "a", "c"))).toEqual(["b", "c", "a", "d"]);
    expect(ids(movedTo(list, "d", "b"))).toEqual(["a", "d", "b", "c"]);
  });

  it("leaves the list alone for a drop on itself or on nothing", () => {
    expect(movedTo(list, "b", "b")).toBe(list);
    expect(movedTo(list, "b", "z")).toBe(list);
  });
});
