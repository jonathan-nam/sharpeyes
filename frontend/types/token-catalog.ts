// Mirrors backend's tokens/TokenRoutes.kt ItemCatalogResponse field-for-field.
//
// Every item that EXISTS, which is not the same list as every item HELD. Deliberately without a
// quantity or a capturedAt: inventing both to describe an item nobody holds would be two figures
// nobody said. What somebody holds is CharacterToken.
export type TokenCatalogItem = {
  tokenCatalogId: string;
  name: string;
  iconUrl: string | null;
  itemGroup: string | null;
  sourceBoss: string | null;
  redeemThreshold: number | null;
  redeemSlots: string[];
};
