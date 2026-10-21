import { useEffect, useRef } from "react";
import { onLive, type Topic } from "@/lib/live-events";

/** Calls [handler] whenever any of [topics] moves, with the handler as of the latest render. */
export function useLive(topics: Topic | Topic[], handler: () => void) {
  const latest = useRef(handler);
  useEffect(() => {
    latest.current = handler;
  });
  const key = ([] as Topic[]).concat(topics).join(",");
  useEffect(() => {
    const stops = key.split(",").map((topic) => onLive(topic as Topic, () => latest.current()));
    return () => stops.forEach((stop) => stop());
  }, [key]);
}
