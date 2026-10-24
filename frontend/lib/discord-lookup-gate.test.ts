import { describe, expect, it } from "vitest";
import { mayAsk } from "@/components/discord-lookup";

const somebody = {
  username: "pellmoor",
  image: null,
  name: "Pellmoor",
  spriteImgUrl: null,
  you: false,
};

// The preview helps; it must never be what stops a request. A backend without the lookup answered
// every name with a failure, and gating on it took Send Request down on prod.
describe("mayAsk", () => {
  it("lets a request go while the lookup is pending or has failed", () => {
    expect(mayAsk("pellmoor", "idle")).toBe(true);
    expect(mayAsk("pellmoor", "failed")).toBe(true);
    expect(mayAsk("pellmoor", somebody)).toBe(true);
  });

  it("holds it only once the lookup has said nobody, or you, or there is no name", () => {
    expect(mayAsk("pellmoor", "none")).toBe(false);
    expect(mayAsk("pellmoor", { ...somebody, you: true })).toBe(false);
    expect(mayAsk("  ", "idle")).toBe(false);
  });
});
