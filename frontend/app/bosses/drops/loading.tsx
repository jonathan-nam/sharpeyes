import { RouteLoading } from "@/components/route-loading";
import { DropLogHead } from "@/components/drop-log-head";
import { DropLogSkeleton } from "@/components/drop-log-skeleton";

// See app/inventory/loading.tsx for why these boundaries exist. The same skeleton the page shows for
// its own fetch, so handing over to it is invisible.
export default function Loading() {
  return (
    <RouteLoading shaped>
      <DropLogHead />
      <DropLogSkeleton />
    </RouteLoading>
  );
}
