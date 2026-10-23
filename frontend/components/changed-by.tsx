"use client";

import { useEffect, useRef, useState } from "react";
import { type LiveEvent, type LiveTarget, onLive, type Topic, TOPICS } from "@/lib/live-events";
import { useSessionUser } from "@/lib/use-auth";

/** As long as the face stays up, matching the `changed-by` animation in globals.css. */
export const CHANGED_BY_MS = 2_500;

type Heard = { event: LiveEvent; at: number };

/** Who, since when, and how far into the window it was when this mounted. */
type Shown = { image: string; at: number; late: number };

// What was heard in the last CHANGED_BY_MS, for what mounts after it. A drop somebody adds is drawn
// only once the page has read it again, which is after its event, so a face that only listened
// would never land on the one thing that is new.
let recent: Heard[] = [];
let listening = false;

function remember() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  // Not presence: it is a cursor moving, not a change, and it arrives many times a second.
  for (const topic of TOPICS.filter((t) => t !== "presence")) {
    onLive(topic, (event) => {
      const now = Date.now();
      recent = [...recent.filter((h) => now - h.at < CHANGED_BY_MS), { event, at: now }];
    });
  }
}

/**
 * The face of whoever else just changed something [matches] picks out, and when they did.
 *
 * Your own writes come back on the same stream (a party's events reach the whole party), so an
 * event made by the signed-in account is never shown. Nor is one with no face to show.
 */
export function useChangedBy(
  topics: Topic[],
  matches: (target: LiveTarget) => boolean,
): Shown | null {
  const { user } = useSessionUser();
  const [shown, setShown] = useState<Shown | null>(null);
  const me = user?.id;
  const key = topics.join(",");
  const latest = useRef(matches);
  useEffect(() => {
    latest.current = matches;
  });

  useEffect(() => {
    remember();
    const wanted = (event: LiveEvent) =>
      !!event.actor &&
      event.actor !== me &&
      !!event.image &&
      key.split(",").includes(event.topic) &&
      latest.current(event.target ?? {});
    const now = Date.now();
    const earlier = recent.filter((h) => now - h.at < CHANGED_BY_MS && wanted(h.event)).at(-1);
    if (earlier) setShown({ image: earlier.event.image!, at: earlier.at, late: now - earlier.at });
    const stops = key.split(",").map((topic) =>
      onLive(topic as Topic, (event) => {
        if (wanted(event)) setShown({ image: event.image!, at: Date.now(), late: 0 });
      }),
    );
    return () => stops.forEach((stop) => stop());
  }, [key, me]);

  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(null), CHANGED_BY_MS - shown.late);
    return () => clearTimeout(timer);
  }, [shown]);

  return shown;
}

/** The face, over the corner of the nearest positioned parent. Decorative: the change is the news. */
export function ChangedBy({
  topics,
  matches,
}: {
  topics: Topic[];
  matches: (target: LiveTarget) => boolean;
}) {
  const shown = useChangedBy(topics, matches);
  if (!shown) return null;
  // Keyed by time, so a second change inside the window starts the fade again. Started part way in
  // when it mounted after the change, so it ends when it would have.
  return (
    <img
      key={shown.at}
      className="changed-by"
      src={shown.image}
      alt=""
      aria-hidden="true"
      style={{ animationDelay: `${-shown.late}ms` }}
    />
  );
}
