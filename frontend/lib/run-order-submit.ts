// The night the run order was built from, as one comparable string.
//
// The plan is frozen at the moment it is asked for, so the button above it has to say whether the
// controls have moved since. A key rather than a reference check: typing a time and deleting it
// again leaves a new object holding the same night, and offering to rebuild an identical plan is
// how a button teaches people to ignore it.
//
// Only what somebody typed goes in. The start of the night follows the clock until it is typed
// over, so keying on the resolved minute would call the plan out of date on its own every half
// hour, with nothing on the page changed.

export type NightControls = {
  openOnly: boolean;
  everyoneOn: boolean;
  timed: boolean;
  /** Ticked off, in click order. */
  away: string[];
  windows: Record<string, { from: string; until: string }>;
  startText: string;
  endText: string | null;
  duration: number;
};

export function controlsKey(controls: NightControls): string {
  return JSON.stringify({
    openOnly: controls.openOnly,
    everyoneOn: controls.everyoneOn,
    timed: controls.timed,
    // Sorted: who was ticked off first is not a difference between two nights.
    away: [...controls.away].sort(),
    // An empty box is the same as no box, which is what closing a chip without typing leaves.
    windows: Object.entries(controls.windows)
      .map(([id, window]) => [id, window.from.trim(), window.until.trim()])
      .filter(([, from, until]) => from !== "" || until !== "")
      .sort((a, b) => (a[0] ?? "").localeCompare(b[0] ?? "")),
    startText: controls.startText.trim(),
    endText: controls.endText === null ? null : controls.endText.trim(),
    duration: controls.duration,
  });
}
