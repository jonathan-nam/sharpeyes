import { apiFetch } from "@/lib/api";
import { differences, goldenJson } from "@/lib/golden-json";
import { dropLogFigures } from "@/lib/money-figures";
import { reportParity } from "@/lib/report-error";
import type { DropLogPage, SharedBook } from "@/types/page";

// Phase 4 of docs/backend-arithmetic-plan.md: the server works out the Drop Log's money too, and a
// sample of page loads compares it with what this browser drew. The screens still read the browser's.

/** The share of page loads that check. The comparison repeats the page's whole composition. */
const SAMPLE = 0.2;

let checked = false;

/** Compares once per page load, when the browser is idle. Never throws, never changes the page. */
export function shadowCompare(
  page: DropLogPage,
  books: SharedBook[],
  getToken: () => Promise<string | null>,
): void {
  if (checked || typeof window === "undefined" || Math.random() >= SAMPLE) return;
  checked = true;
  const idle = window.requestIdleCallback ?? ((run: () => void) => window.setTimeout(run, 2000));
  idle(() => {
    apiFetch<unknown>("/api/pages/drop-log/figures", { method: "GET" }, getToken)
      .then((served) => {
        const wrong = differences(goldenJson(dropLogFigures(page, books)), served);
        if (wrong.length > 0) reportParity(wrong[0] || "root", wrong.length);
      })
      // A failed fetch is reported by apiFetch; a figure that throws here throws on the page too.
      .catch(() => undefined);
  });
}
