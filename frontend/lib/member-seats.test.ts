import { describe, expect, it } from "vitest";
import { memberSeats } from "@/lib/parties";
import type { Party } from "@/types/party";

const party = (fields: Partial<Party>) => fields as Party;

describe("memberSeats", () => {
  it("names the seats a member acts as", () => {
    expect([...(memberSeats(party({ yours: false, yourSeats: ["s1"] })) ?? [])]).toEqual(["s1"]);
  });

  it("is nobody in your own party, which you act in as anybody", () => {
    expect(memberSeats(party({ yours: true }))).toBeNull();
  });
});
