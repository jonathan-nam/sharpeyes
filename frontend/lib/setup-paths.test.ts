import { describe, expect, it } from "vitest";
import { isSetupPath } from "@/lib/setup-paths";

describe("isSetupPath", () => {
  it("is onboarding and an invite, not the pages after", () => {
    expect(isSetupPath("/welcome")).toBe(true);
    expect(isSetupPath("/join/abc")).toBe(true);
    expect(isSetupPath("/bosses/parties")).toBe(false);
    expect(isSetupPath("/welcomes")).toBe(false);
  });
});
