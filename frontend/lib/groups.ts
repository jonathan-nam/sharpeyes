import { apiFetch } from "@/lib/api";
import type { GroupRoster } from "@/types/groups";

export const GROUPS_KEY = "/api/groups";

type TokenGetter = () => Promise<string | null>;

/** One character per groupmate for a new party of [characterId]'s on [bossKey]. See GroupRoster.kt. */
export function groupRoster(
  groupId: string,
  characterId: string,
  bossKey: string,
  getToken: TokenGetter,
): Promise<GroupRoster> {
  const query = new URLSearchParams({ characterId, bossKey });
  return apiFetch<GroupRoster>(
    `${GROUPS_KEY}/${encodeURIComponent(groupId)}/roster?${query.toString()}`,
    { method: "GET" },
    getToken,
  );
}
