import type { DropSectionKey } from "@/lib/drop-sections";

/**
 * The mark a stage's tab wears, ahead of its label.
 *
 * All of these are the game's own item sprites, shipped as static art and drawn 1:1 at their canvas
 * size. See scripts/build-tab-marks.mjs for where they come from and why they are not in the
 * catalog manifest.
 *
 * Settled wears none. It is the one stage that asks nothing of the reader, and it already sits
 * apart at the far end of the row.
 */
const MARK_ART: Partial<Record<DropSectionKey, string>> = {
  drops: "/marks/grindstone-of-faith.png",
  sales: "/marks/money-sack.png",
  settlement: "/marks/owl-of-minerva.png",
};

/** The home screen's marks, by the section each row opens. */
const PAGE_ART: Record<string, string> = {
  "/characters": "/marks/character-slot-coupon.png",
  "/inventory": "/marks/party-quest-bag.png",
  "/bosses": "/marks/intense-power-crystal.png",
  "/bosses/parties": "/marks/party-hat.png",
  "/bosses/drops": "/marks/grindstone-of-faith.png",
};

export function SectionMark({ section }: { section: DropSectionKey }) {
  const src = MARK_ART[section];
  return src ? <img className="tab-art" src={src} alt="" /> : null;
}

export function PageMark({ href }: { href: string }) {
  const src = PAGE_ART[href];
  return src ? <img className="tab-art" src={src} alt="" /> : null;
}
