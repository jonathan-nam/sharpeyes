"use client";

import { useEffect } from "react";
import { apiAssetUrl } from "@/lib/api";
import { announce, backoffMs, eventsIn, TOPICS } from "@/lib/live-events";
import { useAuth } from "@/lib/use-auth";

/**
 * The tab's one connection to GET /api/events, mounted once in the layout.
 *
 * fetch rather than EventSource, which cannot send the Authorization header. The server ends each
 * stream after ten minutes, inside the token's life, and this reconnects with a fresh token. A
 * dropped connection backs off rather than hammering a backend that is restarting.
 */
export function LiveEvents() {
  const { getToken, isLoaded, isSignedIn } = useAuth();

  useEffect(() => {
    // Not before auth answers, or the stream opens as `Bearer null`. See lib/api.ts.
    if (!isLoaded) return;
    if (!isSignedIn) return;
    const stop = new AbortController();
    let failures = 0;

    async function listen() {
      while (!stop.signal.aborted) {
        try {
          const token = await getToken();
          const response = await fetch(apiAssetUrl("/api/events"), {
            headers: { Authorization: `Bearer ${token}` },
            signal: stop.signal,
          });
          if (!response.ok || !response.body) throw new Error(`events ${response.status}`);
          // Whatever moved while this was down was never heard, so every page reads again once.
          if (failures > 0) TOPICS.forEach((topic) => announce(topic));
          failures = 0;
          const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
          let buffer = "";
          for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            const read = eventsIn(buffer + value);
            buffer = read.rest;
            read.events.forEach(announce);
          }
        } catch {
          if (stop.signal.aborted) return;
          failures += 1;
        }
        await new Promise((resolve) =>
          setTimeout(resolve, failures === 0 ? 0 : backoffMs(failures)),
        );
      }
    }

    void listen();
    return () => stop.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, isSignedIn]);

  return null;
}
