import { Tooltip } from "@/components/tooltip";
import type { PartyAccount } from "@/types/party";

/** The accounts a shared party reaches, as their Discord avatars, the leader's starred. */
export function PartyAccounts({ accounts }: { accounts: PartyAccount[] }) {
  if (accounts.length === 0) return null;
  const nameOf = (one: PartyAccount) => (one.you ? "You" : (one.name ?? "Linked account"));
  const leader = accounts.find((one) => one.leader);
  return (
    <span
      className="party-accounts"
      role="img"
      aria-label={`Shared with ${accounts
        .filter((one) => !one.you)
        .map(nameOf)
        .join(", ")}${leader ? `. ${nameOf(leader)} leads.` : ""}`}
    >
      {accounts.map((one, i) => (
        <Tooltip
          // Names can repeat (two people you call the same) and an account appears once, so its
          // position is what is unique in the list.
          key={i}
          text={one.leader ? `${nameOf(one)} · Leader` : nameOf(one)}
        >
          <span className={one.leader ? "party-account is-leader" : "party-account"}>
            {one.image ? (
              <img className="party-account-img" src={one.image} alt="" />
            ) : (
              <span className="party-account-img is-empty">{nameOf(one).slice(0, 1)}</span>
            )}
            {one.leader && (
              <span className="party-account-star" aria-hidden="true">
                ★
              </span>
            )}
          </span>
        </Tooltip>
      ))}
    </span>
  );
}
