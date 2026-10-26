import { CombineParties } from "@/components/combine-parties";
import { SocialHead } from "@/components/social-head";

export default function CombinePage() {
  return (
    <main className="page">
      <SocialHead current="combine" />
      <CombineParties />
    </main>
  );
}
