import type { Party } from "@/types/party";

// What a save did with friends' characters it could not simply seat, said in a dialog from wherever
// the save was made, so one listener in the layout covers every roster form. The sentences come from
// the server (PartyResponse.outcome); an answer from a server before that names only the left out.

const EVENT = "sharpeyes:already-partied";

/** The sentences [saved] carries for friends it asked about or left out. */
export function rosterNotices(saved: Party | null | undefined): string[] {
  const told = (saved?.outcome ?? []).flatMap((o) => (o.text ? [o.text] : []));
  if (told.length > 0) return told;
  const names = saved?.alreadyPartied ?? [];
  return names.length > 0 ? [alreadyPartiedText(names)] : [];
}

/** Opens the dialog when [saved] has anything to say about a friend's character. */
export function announceInvites(saved: Party | null | undefined): void {
  const notices = rosterNotices(saved);
  if (notices.length === 0 || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string[]>(EVENT, { detail: notices }));
}

export function onAlreadyPartied(listener: (notices: string[]) => void): () => void {
  const handle = (e: Event) => listener((e as CustomEvent<string[]>).detail);
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}

/** The sentence for an answer that names no outcome. Two sentences, an error's shape. */
export function alreadyPartiedText(names: string[]): string {
  const who =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const verb = names.length === 1 ? "is" : "are";
  return `${who} ${verb} already in a party for this boss. Ask them to leave it first.`;
}
