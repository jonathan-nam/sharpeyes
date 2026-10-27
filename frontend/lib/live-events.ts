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

/**
 * How long a burst of events waits to become one re-read. One drop sends three (party, loot and
 * settlement from tellLinkedOnWrite), four on a party's page (loot again from poolChanged), and the
 * writer's own tab hears them all on top of its read-back.
 */
export const COALESCE_MS = 100;

/**
 * Runs [run] once for any number of triggers within [waitMs], and never twice at once. A trigger
 * while [run]'s promise is pending runs it once more after it settles, so the last write is read.
 */
export function coalesce(
  run: () => void | Promise<unknown>,
  waitMs = COALESCE_MS,
): { trigger: () => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let again = false;
  let cancelled = false;

  async function fire() {
    timer = null;
    running = true;
    try {
      await run();
    } catch {
      // The handler reports its own failure. A later event must still run.
    } finally {
      running = false;
    }
    if (again) {
      again = false;
      trigger();
    }
  }

  function trigger() {
    if (cancelled) return;
    if (running) {
      again = true;
      return;
    }
    timer ??= setTimeout(() => void fire(), waitMs);
  }

  return {
    trigger,
    cancel: () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    },
  };
}
