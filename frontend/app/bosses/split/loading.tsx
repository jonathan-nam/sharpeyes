import { RouteLoading } from "@/components/route-loading";

// A loading.tsx covers its whole subtree, so without this one /bosses/split would flash the boss
// clears matrix from app/bosses/loading.tsx on the way in: the wrong skeleton for this page.
//
// The split utility fetches nothing and computes everything locally, so there is no data shape to
// stand in for. The title alone is the honest placeholder.
export default function Loading() {
  return (
    <RouteLoading>
      <h1 className="page-title">Drop Splitter</h1>
    </RouteLoading>
  );
}
