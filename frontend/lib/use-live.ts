import { useEffect, useRef } from "react";
import { coalesce, onLive, type Topic } from "@/lib/live-events";

/**
 * Calls [handler] whenever any of [topics] moves, with the handler as of the latest render. A burst
 * is one call (see coalesce), and a handler that returns its promise never overlaps itself.
 */
export function useLive(topics: Topic | Topic[], handler: () => void | Promise<unknown>) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const key = ([] as Topic[]).concat(topics).join(",");
  useEffect(() => {
    const burst = coalesce(() => latest.current());
    const stops = key.split(",").map((topic) => onLive(topic as Topic, burst.trigger));
    return () => {
      stops.forEach((stop) => stop());
      burst.cancel();
    };
  }, [key]);
}
