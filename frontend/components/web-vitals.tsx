"use client";

import { usePathname } from "next/navigation";
import { useReportWebVitals } from "next/web-vitals";
import { useEffect } from "react";
import { markSoftNavigation, reportVital } from "@/lib/rum";

// Feeds Core Web Vitals (LCP, FCP, CLS, INP, TTFB) into the RUM reporter. Next collects
// them with its bundled web-vitals library, so this adds no dependency. Rendered once,
// high in the tree (see layout.tsx); it paints nothing.
export function WebVitals() {
  useReportWebVitals((metric) => {
    reportVital({
      name: metric.name,
      value: metric.value,
      rating: metric.rating,
      id: metric.id,
    });
  });

  // Where a client-side nav gets its zero, from the one component already mounted above every
  // page. Effects run child-first, so the arriving page's fetch may start a tick before this
  // stamps; it is the same commit, and the alternative is every soft nav timed from the document.
  const pathname = usePathname();
  useEffect(() => {
    markSoftNavigation(pathname);
  }, [pathname]);

  return null;
}
