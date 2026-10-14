"use client";

import { useEffect, useRef, useState } from "react";
import {
  type CrossedReset,
  countdownParts,
  formatCountdown,
  msUntil,
  resetToAnnounce,
  serverNowMs,
} from "@/lib/reset-countdown";

// Weekly leads because 15 of the 16 tracked bosses are weekly; monthly follows it, smaller. Daily is
// deliberately absent: it rolls over every night, so a clock on it tells you nothing you would
// plan around.
const TIMER_ORDER = ["WEEKLY", "MONTHLY"] as const;

const LABELS: Record<string, string> = {
  WEEKLY: "Weekly reset",
  MONTHLY: "Monthly reset",
};

const TICK_MS = 1000;

/**
 * Time until each cadence resets, on the server's clock.
 *
 * The instants are served (see BossClearsViewResponse.nextResets); this only counts down to them.
 * Recomputing "next Thursday" here would put a second implementation of the reset boundary in the
 * codebase, and the two silently disagreeing is exactly the failure the matrix is built to avoid.
 *
 * `onReset` fires when one of those instants passes. Reset writes nothing, so the period rolls over
 * with no request having been made and a tab left open keeps drawing last week's ticks under a
 * timer reading "now". This is the only thing on the page that knows the boundary arrived, so the
 * refetch hangs off it. Which boundary, and once per boundary: see resetToAnnounce.
 *
 * It is handed which cadences turned over, not just that something did. A weekly boundary ends the
 * week on screen and a daily one does not, and only the page can decide what to do about that.
 */
export function ResetTimer({
  nextResets,
  serverNow,
  receivedAt,
  onReset,
}: {
  nextResets: Record<string, string>;
  serverNow: string;
  receivedAt: number;
  onReset?: (crossed: CrossedReset) => void;
}) {
  // Seeded from the clock rather than set in the effect. Safe from a hydration mismatch because
  // this only renders once the clears have arrived over the network, so it never runs on the
  // server. A first frame of "–" would otherwise flash on every load.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const nowOnServer = serverNowMs(serverNow, receivedAt, now);

  // The boundary already announced, held in a ref rather than state: announcing one must not
  // itself cause a render, or the tick that crosses midnight renders twice for no visible change.
  const announced = useRef<string | null>(null);

  useEffect(() => {
    const crossed = resetToAnnounce(nextResets, nowOnServer, announced.current);
    if (crossed === null) return;
    announced.current = crossed.at;
    onReset?.(crossed);
  }, [nextResets, nowOnServer, onReset]);

  // A cadence the response did not carry is skipped rather than shown counting to nothing.
  const cadences = TIMER_ORDER.flatMap((cadence) => {
    const at = nextResets[cadence];
    return at ? [{ cadence, at }] : [];
  });
  if (cadences.length === 0) return null;

  return (
    <p className="reset-timer">
      <span className="reset-rows">
        {cadences.map(({ cadence, at }, i) => {
          const remaining = msUntil(at, nowOnServer);
          const parts = countdownParts(remaining);
          return (
            <span key={cadence} className={i === 0 ? "reset-lead" : "reset-minor"}>
              <span className="reset-label">{LABELS[cadence] ?? cadence}</span>
              {/* Each number in a box two digits wide, so 9s becoming 10s does not shove the rest
                  of the line sideways. The text is exactly formatCountdown's; only the spacing is
                  the stylesheet's. A passed reset has no parts and says so in a word. */}
              <span className="reset-value">
                {parts.length === 0
                  ? formatCountdown(remaining)
                  : parts.map((part, at_) => (
                      <span key={part.unit} className="reset-part">
                        {at_ > 0 ? " " : null}
                        <span className="reset-num">{part.value}</span>
                        {part.unit}
                      </span>
                    ))}
              </span>
            </span>
          );
        })}
      </span>
      <span className="reset-zone">UTC</span>
    </p>
  );
}
