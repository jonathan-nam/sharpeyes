import { RouteLoading } from "@/components/route-loading";
import { SocialHead } from "@/components/social-head";

// See app/inventory/loading.tsx. Mirrors app/social/people/page.tsx, hint included, so handing
// over to the page is invisible.
export default function Loading() {
  return (
    <RouteLoading>
      <SocialHead current="people" />
      <p className="party-hint">Loading...</p>
    </RouteLoading>
  );
}
