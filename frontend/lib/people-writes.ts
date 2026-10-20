import { apiFetch } from "@/lib/api";
import type { Invite } from "@/types/invite";
import type { Person, SavePeopleBody } from "@/types/party";

// The People list's writes, shared by Edit People and a party's own Access section.

type GetToken = () => Promise<string | null>;

export const PEOPLE_KEY = "/api/people";
export const INVITES_KEY = "/api/invites";

/** The whole people list, as PUT /api/people takes it. Answers with the list as saved. */
export function savePeople(body: SavePeopleBody, getToken: GetToken): Promise<Person[]> {
  return apiFetch<Person[]>(PEOPLE_KEY, { method: "PUT", body: JSON.stringify(body) }, getToken);
}

/** A fresh invite link for one person, carrying every party they are in. */
export function createInvite(personId: string, getToken: GetToken): Promise<Invite> {
  return apiFetch<Invite>(
    INVITES_KEY,
    { method: "POST", body: JSON.stringify({ personId }) },
    getToken,
  );
}
