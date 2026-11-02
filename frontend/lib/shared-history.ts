import { holderKey, SELF_HOLDER, type Holder } from "@/lib/vestige-ledger";
import type { PartyLootPool } from "@/types/loot";
import type { Party, PartyMember, Person } from "@/types/party";
import type { SharedBook } from "@/types/page";
import type { SettlementDebt, VestigeSettlement } from "@/types/vestige";

/** Somebody else's book with the two of you swapped, so your own log can read it as yours. */
export type SharedHistory = {
  parties: Party[];
  pools: PartyLootPool[];
  settlements: VestigeSettlement[];
  debts: SettlementDebt[];
  /** The owner's holder key from your side, named as you call them. */
  names: Map<string, string>;
};

/**
 * Swaps you and the owner in their book: the seats they file under your person row become yours,
 * and theirs become a person of yours.
 *
 * Seats and holders only. Every figure is then worked out by the same code your own book goes
 * through, so a shared drop cannot read differently from one of your own. Their tranches and
 * payments are left out: those are their pile's ledger, and your side of it is the Settlement card.
 */
export function fromYourSide(book: SharedBook): SharedHistory {
  // A synthetic id where you never added them, which still keeps their seats one pile.
  const ownerId = book.ownerPersonId ?? `owner-of:${book.personId}`;
  const owner: Holder = { kind: "PERSON", personId: ownerId, characterName: null };

  const seat = (m: PartyMember): PartyMember => {
    if (m.personId === book.personId)
      return { ...m, personId: null, personName: null, characterId: m.linkedCharacterId ?? m.id };
    if (m.characterId !== null)
      return { ...m, characterId: null, personId: ownerId, personName: book.ownerName };
    return m;
  };
  const holder = (h: Holder): Holder => {
    if (h.kind === "SELF") return owner;
    if (h.kind === "PERSON" && h.personId === book.personId) return SELF_HOLDER;
    return h;
  };

  const parties = book.parties.map((party) => {
    const seats = party.seats.map(seat);
    const yours = seats.find((m) => m.characterId !== null);
    return {
      ...party,
      characterId: yours?.characterId ?? party.characterId,
      members: party.members.map(seat),
      seats,
      yours: false,
    };
  });

  return {
    parties,
    pools: book.pools,
    settlements: book.settlements.map((act) => ({ ...act, holder: holder(act.holder) })),
    debts: book.debts.map((debt) => ({ ...debt, holder: holder(debt.holder) })),
    names: new Map([[holderKey(owner), book.ownerName]]),
  };
}

/** Shares in other owners' parties that are yours to settle, for settlementView. See crossingShares. */
export type Crossing = {
  parties: Party[];
  pools: PartyLootPool[];
  /** Each owner's holder key: that pair is the shared card's, never your own book's. */
  skip: Set<string>;
};

/**
 * The shares in other owners' parties between a seat of yours and a third person's: money between
 * you two that neither owner's book carries. Their seat is keyed to your own people by character
 * name, or else stands as a character, since the owner's person ids mean nothing in your book.
 */
export function crossingShares(shared: SharedHistory, people: Person[]): Crossing {
  const byName = new Map(
    people.flatMap((p) => p.characters.map((c) => [c.toLowerCase(), p] as const)),
  );
  const skip = new Set(shared.names.keys());
  const seat = (m: PartyMember): PartyMember => {
    if (m.characterId !== null || (m.personId !== null && skip.has(`person:${m.personId}`)))
      return m;
    const person = byName.get(m.name.toLowerCase());
    return { ...m, personId: person?.id ?? null, personName: person?.name ?? null };
  };
  return {
    parties: shared.parties.map((party) => ({
      ...party,
      members: party.members.map(seat),
      seats: party.seats.map(seat),
    })),
    pools: shared.pools,
    skip,
  };
}

/** Every shared book from your side, as one set of lists to add to your own. */
export function sharedHistory(books: SharedBook[]): SharedHistory {
  const sides = books.map(fromYourSide);
  return {
    parties: sides.flatMap((s) => s.parties),
    pools: sides.flatMap((s) => s.pools),
    settlements: sides.flatMap((s) => s.settlements),
    debts: sides.flatMap((s) => s.debts),
    names: new Map(sides.flatMap((s) => [...s.names])),
  };
}
