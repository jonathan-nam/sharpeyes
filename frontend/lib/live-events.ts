// Live events from GET /api/events (backend events/), as window events any page can listen for.
//
// The stream says only WHICH thing moved, never what it is now: a page that hears a topic reads its
// own data again, through the same request it always makes, so a live update cannot disagree with
// a reload.

/** The topics the backend sends. See events/Topic.kt. A name not here is ignored. */
export const TOPICS = ["clears", "loot", "notifications"] as const;
export type Topic = (typeof TOPICS)[number];

const EVENT = "sharpeyes:live";

/**
 * The topics in [buffer]'s complete events, and what is left of an event still arriving.
 *
 * Server-sent events end with a blank line. A comment (`: ping`) names nothing, and a topic this
 * build does not know is dropped rather than passed on to a page that cannot act on it.
 */
export function topicsIn(buffer: string): { topics: Topic[]; rest: string } {
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  const topics = blocks
    .map((block) =>
      block
        .split("\n")
        .find((line) => line.startsWith("event: "))
        ?.slice(7)
        .trim(),
    )
    .filter((name): name is Topic => (TOPICS as readonly string[]).includes(name ?? ""));
  return { topics, rest };
}

/** Tells every listener on this tab that [topic] moved. */
export function announce(topic: Topic) {
  window.dispatchEvent(new CustomEvent<Topic>(EVENT, { detail: topic }));
}

/** Calls [listener] whenever [topic] moves. Returns the unsubscribe. */
export function onLive(topic: Topic, listener: () => void): () => void {
  const handler = (e: Event) => {
    if ((e as CustomEvent<Topic>).detail === topic) listener();
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** How long to wait before reconnecting after [failures] in a row: 2s doubling, at most 30s. */
export function backoffMs(failures: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, failures - 1));
}
