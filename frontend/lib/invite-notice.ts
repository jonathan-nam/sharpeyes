import type { Party } from "@/types/party";

// A save that named a friend already in a party for the boss sent them no invite. Said in a dialog,
// from wherever the save was made, so one listener in the layout covers every roster form.

const EVENT = "sharpeyes:already-partied";

/** Opens the dialog when [saved] names anybody it could not invite. */
export function announceInvites(saved: Party | null | undefined): void {
  const names = saved?.alreadyPartied ?? [];
  if (names.length === 0 || typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string[]>(EVENT, { detail: names }));
}

export function onAlreadyPartied(listener: (names: string[]) => void): () => void {
  const handle = (e: Event) => listener((e as CustomEvent<string[]>).detail);
  window.addEventListener(EVENT, handle);
  return () => window.removeEventListener(EVENT, handle);
}

/** The dialog's sentence for these names. Two sentences, an error's shape. */
export function alreadyPartiedText(names: string[]): string {
  const who =
    names.length === 1
      ? names[0]
      : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const verb = names.length === 1 ? "is" : "are";
  return `${who} ${verb} already in a party for this boss. Ask them to leave it first.`;
}
