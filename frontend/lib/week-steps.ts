/**
 * Where the arrows go when stepping through a list of weeks, newest first, with "" for every week.
 *
 * Every week stands where the week in progress does on Party View: back from it is the newest week,
 * and forward from the newest week is back to it. Null is an arrow with nowhere to go.
 */
export function stepThrough(
  weeks: string[],
  shown: string,
): { previous: string | null; next: string | null } {
  if (shown === "") return { previous: weeks[0] ?? null, next: null };
  const at = weeks.indexOf(shown);
  if (at < 0) return { previous: null, next: null };
  return { previous: weeks[at + 1] ?? null, next: at === 0 ? "" : weeks[at - 1]! };
}
