// Mirrors backend's parties/PiecePileRoutes.kt field-for-field.

export type PieceTake = {
  memberId: string;
  quantity: number;
};

// One week's pooled pile of Eternal pieces on a party, and what each seat took of it.
export type PiecePile = {
  partyId: string;
  weekStart: string;
  tokenCatalogId: string;
  tokenName: string;
  iconUrl: string | null;
  difficulty: string;
  total: number;
  stackSize: number;
  // Corrected by hand, so the clear and the config no longer re-file it.
  edited: boolean;
  takes: PieceTake[];
};

// PUT /api/parties/{id}/pieces. Every seat sent; the takes add up to the total in whole stacks.
export type SavePiecePileBody = {
  weekStart: string;
  total: number;
  takes: Record<string, number>;
};
