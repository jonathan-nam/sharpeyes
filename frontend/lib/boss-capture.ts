import type { DetectedBossClear, ScreenshotResult } from "@/types/screenshot";

// The backend saves a planner capture's clears whether or not these two signals are clean:
// decideOutcome (ScreenshotIngestion.kt) never consults either. So if the upload does not say so,
// nothing will, and both failures are invisible in the matrix afterwards. A row the reader could
// not name is absent, which renders as "no capture this period"; a list that was cut off short is
// absent in exactly the same way. Neither looks like an error, which is what makes them worth
// shouting about.
export function recaptureWarnings(
  result: Pick<ScreenshotResult, "unreadableBossRows" | "reachedBossListEnd">,
): string[] {
  const warnings: string[] = [];

  const unreadable = result.unreadableBossRows ?? 0;
  if (unreadable > 0) {
    warnings.push(
      unreadable === 1
        ? "One row couldn't be matched to a boss, so it is missing here. Capture again to fill it in."
        : `${unreadable} rows couldn't be matched to a boss, so they are missing here. Capture again to fill them in.`,
    );
  }

  // Explicitly false, not merely falsy: null means the reader did not say, and "we don't know"
  // must not be reported as "it was cut off".
  if (result.reachedBossListEnd === false) {
    warnings.push(
      "This capture didn't reach the bottom of the boss list. Scroll the planner down and add another.",
    );
  }

  return warnings;
}

export function clearsNote(saved: boolean, clears: DetectedBossClear[]): string {
  if (clears.length === 0) return "No boss rows were read from this screenshot.";
  const cleared = clears.filter((c) => c.cleared).length;
  const read = `${cleared} of ${clears.length} cleared`;
  return saved ? `${read}. Saved.` : `${read}. Nothing has been saved yet.`;
}
