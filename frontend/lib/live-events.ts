// Live events from GET /api/events (backend events/), as window events any page can listen for.
//
// The stream says only WHICH thing moved, never what it is now: a page that hears a topic reads its
// own data again, through the same request it always makes, so a live update cannot disagree with
// a reload.

/** The topics the backend sends. See events/Topic.kt. A name not here is ignored. */
export const TOPICS = [
  "clears",
  "loot",
  "party",
  "settlement",
  "friends",
  "notifications",
  "presence",
] as const;
export type Topic = (typeof TOPICS)[number];

const EVENT = "sharpeyes:live";

/** What a write touched, as far as the backend knew. See events/Publish.kt. */
export type LiveTarget = { party?: string | null; loot?: string | null; person?: string | null };

/** One event off the stream: the topic, and who made the change when it was somebody. */
export type LiveEvent = {
  topic: Topic;
  actor?: string | null;
  image?: string | null;
  target?: LiveTarget;
  /** On a presence event only: where they are. See lib/presence.ts. */
  presence?: PresencePing & { name?: string | null };
};

/** Where one account is on a page. Mirrors the backend's events/Presence.kt. */
export type PresencePing = {
  page: string;
  here: boolean;
  scope?: string | null;
  x?: number | null;
  y?: number | null;
  target?: string | null;
};

function dataOf(line: string | undefined): Omit<LiveEvent, "topic"> {
  try {
    return line ? JSON.parse(line.slice(6)) : {};
  } catch {
    return {};
  }
}

/**
 * The complete events in [buffer], and what is left of an event still arriving.
 *
 * Server-sent events end with a blank line. A comment (`: ping`) names nothing, and a topic this
 * build does not know is dropped rather than passed on to a page that cannot act on it.
 */
export function eventsIn(buffer: string): { events: LiveEvent[]; rest: string } {
  const blocks = buffer.split("\n\n");
  const rest = blocks.pop() ?? "";
  const events = blocks.flatMap((block): LiveEvent[] => {
    const lines = block.split("\n");
    const topic = lines
      .find((line) => line.startsWith("event: "))
      ?.slice(7)
      .trim();
    if (!(TOPICS as readonly string[]).includes(topic ?? "")) return [];
    return [{ ...dataOf(lines.find((line) => line.startsWith("data: "))), topic: topic as Topic }];
  });
  return { events, rest };
}

/** Tells every listener on this tab that [event]'s topic moved. A bare topic is nobody's change. */
export function announce(event: LiveEvent | Topic) {
  const detail = typeof event === "string" ? { topic: event } : event;
  window.dispatchEvent(new CustomEvent<LiveEvent>(EVENT, { detail }));
}

/** Calls [listener] whenever [topic] moves. Returns the unsubscribe. */
export function onLive(topic: Topic, listener: (event: LiveEvent) => void): () => void {
  const handler = (e: Event) => {
    const event = (e as CustomEvent<LiveEvent>).detail;
    if (event.topic === topic) listener(event);
  };
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}

/** How long to wait before reconnecting after [failures] in a row: 2s doubling, at most 30s. */
export function backoffMs(failures: number): number {
  return Math.min(30_000, 2_000 * 2 ** Math.max(0, failures - 1));
}
