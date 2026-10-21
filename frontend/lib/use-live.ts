import { useEffect, useRef } from "react";
import { onLive, type Topic } from "@/lib/live-events";

/** Calls [handler] whenever [topic] moves, with the handler as of the latest render. */
export function useLive(topic: Topic, handler: () => void) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  useEffect(() => onLive(topic, () => latest.current()), [topic]);
}
