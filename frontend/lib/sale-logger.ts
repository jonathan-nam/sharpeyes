import { isMine } from "@/lib/wallet";
import type { PartyLootPool } from "@/types/loot";
import type { PartyMember } from "@/types/party";

/**
 * The pools cut by who logged each drop: whoever logged it sells it (LootPermissions.kt), so only
 * your own go to the sale forms and the rest of the party's are shown and not offered.
 *
 * `recordedByYou` absent is a payload from before the field, which was always yours.
 */
export function splitByLogger(pools: PartyLootPool[]): {
  yours: PartyLootPool[];
  theirs: PartyLootPool[];
} {
  const cut = (keep: boolean) =>
    pools
      .map((pool) => ({
        ...pool,
        loot: pool.loot.filter((l) => (l.recordedByYou !== false) === keep),
      }))
      .filter((pool) => pool.loot.length > 0);
  return { yours: cut(true), theirs: cut(false) };
}

/**
 * Who a sale can name as seller, yours first. You logged it, so you sold it: in a party you are only
 * in, that is one of your own seats; in your own, also anybody not on the site, whose sales you
 * record for them, but never another account's, which logs and sells its own. See LootPermissions.kt.
 */
export function sellersOf(ran: PartyMember[], onlyIn: boolean): PartyMember[] {
  const mine = ran.filter(isMine);
  return onlyIn
    ? mine
    : [...mine, ...ran.filter((s) => !isMine(s) && s.linkedCharacterId === null)];
}
