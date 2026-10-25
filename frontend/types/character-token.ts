// Mirrors backend's characters/CharacterDtos.kt CharacterItemResponse field-for-field.
export type CharacterToken = {
  tokenCatalogId: string;
  name: string;
  iconUrl: string | null;
  quantity: number;
  itemGroup: string | null;
  // The boss it drops from. Search matches on it.
  sourceBoss: string | null;
  // Null for a consumable. There is no category flag: an item is redeemable exactly when
  // it has a redemption rule, so a null threshold IS the answer to "is this redeemable?".
  redeemThreshold: number | null;
  // Which Eternal pieces this buys. Empty for a consumable.
  redeemSlots: string[];
  capturedAt: string;
};
