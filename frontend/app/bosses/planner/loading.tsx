import { RouteLoading } from "@/components/route-loading";

// Without its own, /bosses/loading.tsx would flash the clears matrix on the way in.
export default function Loading() {
  return (
    <RouteLoading>
      <h1 className="page-title">Party Planner</h1>
    </RouteLoading>
  );
}
