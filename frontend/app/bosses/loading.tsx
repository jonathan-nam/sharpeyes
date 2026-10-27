import { RouteLoading } from "@/components/route-loading";
import { BossMatrix } from "@/components/boss-matrix";

// See app/inventory/loading.tsx for why these boundaries exist, and for the dock both of them
// stood long after the pages stopped drawing one.
//
// The empty arrays are deliberate, not a placeholder: BossMatrix substitutes its own
// SKELETON_BOSSES/SKELETON_CHARACTERS when asked to load with nothing to lay out, so this is the
// same shimmer table the page itself shows. Nothing to seed from here, this renders on the server.
export default function Loading() {
  return (
    <RouteLoading shaped>
      <h1 className="page-title">Boss Matrix</h1>
      <BossMatrix loading bosses={[]} characters={[]} clearsByCharacter={{}} />
    </RouteLoading>
  );
}
