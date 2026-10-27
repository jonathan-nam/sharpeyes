// Generated from shared/api by GeneratedTypesTest. Do not edit: change the Kotlin, then run
// UPDATE_API_TYPES=1 ./gradlew -p shared/api jvmTest (from backend/, with backend's gradlew).

export type AcceptInviteRequest = {
  characters?: string[] | null;
};

export type AcceptedInvite = {
  charactersCreated: number;
  peopleCreated: number;
  partiesCreated: number;
  omitted: InviteOmission[];
};

export type Actor = {
  name: string | null;
  username: string | null;
  spriteImgUrl: string | null;
  image?: string | null;
};

export type AddCouponSaleRequest = {
  holder: VestigeHolder;
  pieces: number;
  amount?: number | null;
  disposition?: string;
  shares?: CouponSaleShareRow[];
};

export type AddCouponSettlementRequest = {
  holder: VestigeHolder;
  lootIds: string[];
  unpaid?: number;
};

export type AddHeldMoneyRequest = {
  holder: VestigeHolder;
  amount: number;
  kind: string;
  heldBy?: string;
};

export type AddLootRequest = {
  dropKey?: string | null;
  customName?: string | null;
  bossKey?: string | null;
  quantity?: number;
  droppedOn?: string | null;
  bundles?: Record<string, number> | null;
  again?: boolean;
};

export type AddPaymentRequest = {
  holder: VestigeHolder;
  amount: number;
  note?: string | null;
};

export type AddSettlementDebtRequest = {
  holder: VestigeHolder;
  amount: number;
  note?: string | null;
  payouts?: SettlementDebtPayoutRow[];
  incurredAt?: string | null;
};

export type BossClearResponse = {
  bossKey: string;
  cleared: boolean;
  periodStart: string;
  capturedAt: string;
};

export type BossClearsViewResponse = {
  clearsByCharacter: Record<string, BossClearResponse[]>;
  skipsByCharacter: Record<string, string[]>;
  weekStart: string | null;
  previousWeekStart: string | null;
  nextWeekStart: string | null;
  currentWeekStart: string;
  nextResets: Record<string, string>;
  now: string;
};

export type BossDropResponse = {
  dropKey: string;
  name: string;
  iconUrl: string | null;
  perMember: string | null;
  worlds: string | null;
  quantity: number;
  fungible: boolean;
  pieces: Record<string, Record<string, number>>;
  bundles: Record<string, Record<string, number>>;
};

export type BossPieceResponse = {
  difficulty: string;
  world: string;
  tokenName: string;
  iconUrl: string | null;
  quantity: number;
  stackSize: number;
  pooled: boolean;
};

export type BossResponse = {
  bossKey: string;
  name: string;
  reset: string;
  iconUrl: string | null;
  difficulties: string[];
  pieces?: BossPieceResponse[];
};

export type BulkSaleRequest = {
  dropKey: string;
  total: number;
  amountBasis: string;
  splitMethod: string;
  rows: BulkSaleRow[];
};

export type BulkSaleRow = {
  partyId: string;
  lootId: string;
  amount: number;
  sellerMemberId: string;
  shares?: Record<string, number>;
};

export type CharacterItemResponse = {
  tokenCatalogId: string;
  name: string;
  iconUrl: string | null;
  quantity: number;
  itemGroup: string | null;
  sourceBoss: string | null;
  redeemThreshold: number | null;
  redeemSlots: string[];
  capturedAt: string;
};

export type CharacterResponse = {
  id: string;
  name: string;
  level: number | null;
  jobName: string | null;
  worldName: string | null;
  worldType: string;
  spriteImgUrl: string | null;
  spriteRefreshedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ClientErrorReport = {
  kind: string;
  path?: string | null;
  status?: number | null;
  route?: string | null;
  nav?: string | null;
  conn?: string | null;
  device?: string | null;
  tz?: string | null;
  lang?: string | null;
  v?: string | null;
  field?: string | null;
  count?: number | null;
};

export type CorrectCouponSaleRequest = {
  amount: number;
};

export type CouponSaleResponse = {
  id: string;
  holder: VestigeHolder;
  pieces: number;
  amount: number | null;
  disposition: string;
  shares: CouponSaleShareRow[];
  soldAt: string;
  recordedByYou?: boolean;
  recordedByName?: string | null;
};

export type CouponSaleShareRow = {
  holder: VestigeHolder;
  pieces: number;
};

export type CouponSettlementResponse = {
  id: string;
  holder: VestigeHolder;
  lootIds: string[];
  unpaid: number;
  settledAt: string;
};

export type CreateCharacterRequest = {
  name: string;
};

export type CreateInviteRequest = {
  personId: string;
};

export type DetectedBossClearResponse = {
  bossKey: string;
  displayName: string;
  cleared: boolean;
};

export type DetectedItemResponse = {
  tokenName: string;
  displayName: string;
  tokenCatalogId: string | null;
  itemGroup: string | null;
  iconUrl: string | null;
  quantity: number;
};

export type DiscordLookupAnswer = {
  found: DiscordLookupResponse | null;
};

export type DiscordLookupResponse = {
  username: string;
  image: string | null;
  name: string | null;
  spriteImgUrl: string | null;
  you: boolean;
};

export type DropLogPageResponse = {
  parties: PartyResponse[];
  pools: PartyLootPoolResponse[];
  tranches: CouponSaleResponse[];
  payments: PaymentResponse[];
  settlements: CouponSettlementResponse[];
  debts: SettlementDebtResponse[];
  disposals: HeldMoneyResponse[];
  bosses: BossResponse[];
  drops: Record<string, BossDropResponse[]>;
  characters: CharacterResponse[];
  people: PersonResponse[];
};

export type DuplicateParty = {
  refusal: string;
  partyId: string;
};

export type EventTarget = {
  party: string | null;
  loot: string | null;
  person: string | null;
};

export type FriendView = {
  id: string;
  username: string | null;
  name: string | null;
  spriteImgUrl: string | null;
  image?: string | null;
};

export type HeldMoneyResponse = {
  id: string;
  holder: VestigeHolder;
  amount: number;
  kind: string;
  decidedAt: string;
  heldBy?: string;
  recordedByYou?: boolean;
  recordedByName?: string | null;
};

export type IncomingInviteView = {
  id: string;
  partyId: string;
  character: string;
  boss: string;
  difficulty: string | null;
  leader: string;
};

export type InviteOmission = {
  bossKey: string;
  characterName: string;
  reason: string;
};

export type InvitePartyLabel = {
  bossName: string;
  difficulty: string | null;
  characterName: string;
};

export type InvitePreview = {
  senderName: string;
  senderSprite: string | null;
  characters: string[];
  parties: InvitePartyLabel[];
  peopleCount: number;
  omitted: InviteOmission[];
};

export type InviteResponse = {
  id: string;
  personId: string;
  personName: string;
  senderName: string;
  token: string | null;
  createdAt: string;
  expiresAt: string;
  accepted: boolean;
  characterCount: number;
  partyCount: number;
  omitted: InviteOmission[];
};

export type ItemCatalogResponse = {
  tokenCatalogId: string;
  name: string;
  iconUrl: string | null;
  itemGroup: string | null;
  sourceBoss: string | null;
  redeemThreshold: number | null;
  redeemSlots: string[];
};

export type ItemTotalResponse = {
  tokenCatalogId: string;
  name: string;
  iconUrl: string | null;
  quantity: number;
  itemGroup: string | null;
  redeemThreshold: number | null;
  characterCount: number;
};

export type JoinedPartyResponse = {
  partyId: string;
};

export type LiveData = {
  actor: string | null;
  image: string | null;
  target: EventTarget;
};

export type LogDropRequest = {
  characterId: string;
  bossKey: string;
  dropKey?: string | null;
  customName?: string | null;
  quantity?: number;
  droppedOn?: string | null;
};

export type LootBundleResponse = {
  memberId: string;
  bundles: number;
};

export type LootBundlesRequest = {
  bundles?: Record<string, number>;
};

export type LootPayoutResponse = {
  memberId: string;
  paid: boolean;
  paidAt: string | null;
  shares: number;
};

export type LootResponse = {
  id: string;
  dropKey: string | null;
  customName: string | null;
  name: string;
  iconUrl: string | null;
  perMember: string | null;
  bossKey: string | null;
  quantity: number;
  difficulty: string | null;
  droppedOn: string;
  weekStart: string;
  status: string;
  saleAmount: number | null;
  saleUsdCents?: number | null;
  amountBasis: string | null;
  splitMethod: string | null;
  sellerShares: number | null;
  sellerMemberId: string | null;
  takenByMemberId: string | null;
  solo?: boolean;
  soldAt: string | null;
  recordedAt?: string;
  payouts: LootPayoutResponse[];
  ranThatWeek: string[];
  sharesThatWeek?: Record<string, number>;
  bundles: number | null;
  bundlesBy: LootBundleResponse[];
  recordedByYou?: boolean;
  recordedByName?: string | null;
  settled?: boolean;
};

export type NotificationAction = {
  label: string;
  primary: boolean;
  href: string | null;
  method: string | null;
  path: string | null;
};

export type NotificationView = {
  id: string;
  kind: string;
  subjectId: string | null;
  createdAt: string;
  read: boolean;
  actor: Actor | null;
  payload: unknown;
  text?: string | null;
  actions?: NotificationAction[];
};

export type NotificationsResponse = {
  unread: number;
  notifications: NotificationView[];
};

export type OffsetPartRow = {
  lootId: string;
  memberId: string;
  amount?: number;
};

export type OffsetSharesRequest = {
  holder: VestigeHolder;
  note?: string | null;
  parts?: OffsetPartRow[];
  holding?: number | null;
  received?: OffsetPartRow[];
  heldByThem?: number | null;
};

export type OffsetSharesResponse = {
  pools: PartyLootPoolResponse[];
  debts: SettlementDebtResponse[];
  disposals: HeldMoneyResponse[];
};

export type PartiesExtrasResponse = {
  clears: BossClearsViewResponse;
  drops: Record<string, BossDropResponse[]>;
  people: PersonResponse[];
  pools: PartyLootPoolResponse[];
  settlements: CouponSettlementResponse[];
  seated: SeatedPartyResponse[];
  seatedPools?: PartyLootPoolResponse[];
};

export type PartiesPageResponse = {
  parties: PartyResponse[];
  bosses: BossResponse[];
  characters: CharacterResponse[];
};

export type PartyAccountResponse = {
  name: string | null;
  image: string | null;
  leader: boolean;
  you: boolean;
};

export type PartyLootPoolResponse = {
  partyId: string;
  loot: LootResponse[];
};

export type PartyMemberResponse = {
  id: string;
  name: string;
  personId: string | null;
  personName: string | null;
  characterId: string | null;
  linkedCharacterId: string | null;
  spriteImgUrl: string | null;
  guest: boolean;
  shares: number;
  pieceShares?: number;
};

export type PartyResponse = {
  id: string;
  slug: string;
  characterId: string;
  worldType: string;
  bossKey: string;
  difficulty: string | null;
  weekDifficulty?: string | null;
  minutes: number | null;
  solo: boolean;
  oneOff: boolean;
  retired: boolean;
  members: PartyMemberResponse[];
  seats: PartyMemberResponse[];
  usualRoster: boolean;
  skippedThisPeriod: boolean;
  ranAsParty?: boolean;
  pendingLoot: number;
  awaitingPayout: number;
  settledLoot: number;
  cleared: boolean | null;
  clearedByHand: boolean;
  yours?: boolean;
  yourSeats?: string[];
  accounts?: PartyAccountResponse[];
  pendingInvites?: PendingInviteView[];
  invited: string[];
  alreadyPartied: string[];
  outcome?: RosterNameOutcome[];
  createdAt: string;
  updatedAt: string;
};

export type PaymentResponse = {
  id: string;
  holder: VestigeHolder;
  amount: number;
  note: string | null;
  receivedAt: string;
  recordedByYou?: boolean;
  recordedByName?: string | null;
};

export type PayoutRef = {
  lootId: string;
  memberId: string;
};

export type PayoutRequest = {
  paid: boolean;
};

export type PendingInviteView = {
  id: string;
  name: string;
};

export type PendingLink = {
  id: string;
  username: string | null;
};

export type PersonRequest = {
  id?: string | null;
  name: string;
  characters?: string[];
};

export type PersonResponse = {
  id: string;
  name: string;
  characters: string[];
  ownedCharacters: string[];
  ownedJobs?: Record<string, string>;
  sprites?: Record<string, string>;
  jobs?: Record<string, string>;
  linked: boolean;
  image?: string | null;
  notOnAccount?: string[];
  contested: string[];
  pinned: boolean;
  request?: PendingLink | null;
};

export type PiecePileResponse = {
  partyId: string;
  weekStart: string;
  tokenCatalogId: string;
  tokenName: string;
  iconUrl: string | null;
  difficulty: string;
  total: number;
  stackSize: number;
  takes: PieceTakeResponse[];
};

export type PieceSyncGap = "NO_DIFFICULTY" | "PARTY_OFF" | "PARTY_LOOT";

export type PieceSyncGapResponse = {
  characterId: string;
  characterName: string;
  bossKey: string;
  bossName: string;
  reason: PieceSyncGap;
};

export type PieceSyncResponse = {
  enabled: boolean;
  gaps: PieceSyncGapResponse[];
};

export type PieceTakeResponse = {
  memberId: string;
  quantity: number;
};

export type PinPersonRequest = {
  pinned: boolean;
};

export type PingResponse = {
  userId: string;
  dbTimestamp: string;
};

export type Refusal = {
  refusal: string;
};

export type ReorderCharactersRequest = {
  orderedIds: string[];
};

export type ReportFiguresRequest = {
  figures: ReportedFigure[];
};

export type ReportedFigure = {
  personId: string;
  payer: string;
  amount: number;
};

export type ResolveScreenshotRequest = {
  characterId: string;
};

export type RosterNameOutcome = {
  name: string;
  result: RosterResult;
  text: string | null;
};

export type RosterResult = "SEATED" | "ASKED" | "GUEST" | "LEFT_OUT";

export type SaveMainCharacterRequest = {
  characterId?: string | null;
};

export type SavePartyRequest = {
  characterId: string;
  bossKey: string;
  members?: string[];
  shares?: Record<string, number>;
  pieceShares?: Record<string, number>;
  difficulty?: string | null;
  minutes?: number | null;
  oneOff?: boolean;
  separate?: boolean;
};

export type SavePeopleRequest = {
  people?: PersonRequest[];
};

export type SavePiecePileRequest = {
  weekStart: string;
  total: number;
  takes: Record<string, number>;
};

export type SavePieceSyncRequest = {
  enabled: boolean;
};

export type SavePlannerRequest = {
  draft: unknown;
};

export type SaveSettingsRequest = {
  worldType: string;
};

export type SaveSharesRequest = {
  shares?: Record<string, number>;
};

export type SaveWeekRosterRequest = {
  week?: string | null;
  members?: string[] | null;
};

export type SavedPlannerResponse = {
  draft: unknown | null;
  savedAt: string | null;
};

export type ScreenshotOutcome = "MATCHED" | "MISMATCH" | "NEW_CHARACTER_DETECTED" | "UNRESOLVABLE" | "UNRECOGNIZED_SCREENSHOT" | "FAILED";

export type ScreenshotResultResponse = {
  screenshotId: string;
  outcome: ScreenshotOutcome;
  detectedCharacterName: string | null;
  detectedLevel: number | null;
  pinnedCharacterName: string | null;
  failureReason: string | null;
  tokenCounts: DetectedItemResponse[];
  bossClears: DetectedBossClearResponse[];
  unreadableBossRows: number | null;
  reachedBossListEnd: boolean | null;
};

export type SeatedPartyResponse = {
  party: PartyResponse;
  mySeatIds: string[];
  yourCharacterId: string;
};

export type SellLootRequest = {
  amount: number;
  amountBasis: string;
  splitMethod: string;
  sellerMemberId: string;
  shares?: Record<string, number>;
  usdCents?: number | null;
};

export type SendFriendRequest = {
  username: string;
};

export type SentInviteView = {
  id: string;
  partyId: string;
  character: string;
  boss: string;
  difficulty: string | null;
  leader: string;
};

export type SetBossClearRequest = {
  characterId: string;
  bossKey: string;
  cleared: boolean;
};

export type SetBossRoutineRequest = {
  characterId: string;
  skippedBossKeys?: string[];
};

export type SetClearRequest = {
  cleared: boolean;
};

export type SetItemCountRequest = {
  quantity: number;
};

export type SetPartySkipRequest = {
  week?: string | null;
  skipped: boolean;
};

export type SetSoloDifficultyRequest = {
  characterId: string;
  bossKey: string;
  difficulty?: string | null;
};

export type SettingsResponse = {
  worldType: string | null;
  trades: boolean;
  otherWorldCharacters: number;
  mainCharacterId: string | null;
  mainCharacterSprite: string | null;
  mainCharacterName: string | null;
};

export type SettleRequest = {
  payouts: PayoutRef[];
};

export type SettlementDebtPayoutRow = {
  lootId: string;
  memberId: string;
};

export type SettlementDebtResponse = {
  id: string;
  holder: VestigeHolder;
  amount: number;
  note: string | null;
  payouts: SettlementDebtPayoutRow[];
  incurredAt: string;
  recordedByYou?: boolean;
  recordedByName?: string | null;
};

export type SettlementListingView = {
  id: string;
  personId: string;
  payer: string;
  amount: number;
  postedByYou: boolean;
  createdAt: string;
};

export type SharedCloseRequest = {
  note?: string | null;
  parts?: OffsetPartRow[];
  holding?: number | null;
  received?: OffsetPartRow[];
  heldByThem?: number | null;
};

export type SharedDisposalRequest = {
  amount: number;
  kind: string;
  heldBy: string;
};

export type SharedMoneyRequest = {
  amount: number;
  note?: string | null;
};

export type SharedPartiesResponse = {
  ownerName: string;
  ownerImage?: string | null;
  personId: string;
  ownerPersonId?: string | null;
  parties: PartyResponse[];
  pools: PartyLootPoolResponse[];
  tranches: CouponSaleResponse[];
  payments: PaymentResponse[];
  settlements: CouponSettlementResponse[];
  debts: SettlementDebtResponse[];
  disposals: HeldMoneyResponse[];
};

export type SharedTrancheRequest = {
  pieces: number;
  amount?: number | null;
  disposition?: string;
  shares?: CouponSaleShareRow[];
};

export type SocialResponse = {
  username: string | null;
  friends: FriendView[];
  outgoing: FriendView[];
  incoming?: FriendView[];
};

export type SpriteLookupRequest = {
  names: string[];
};

export type SpriteLookupResponse = {
  sprites: Record<string, string | null>;
  jobs: Record<string, string | null>;
};

export type TakenRequest = {
  memberId?: string | null;
};

export type UpdateCharacterRequest = {
  name?: string | null;
  level?: number | null;
};

export type UploadScreenshotRequest = {
  imageBase64: string;
  mediaType: string;
  characterId?: string | null;
};

export type VestigeHolder = {
  kind: string;
  personId: string | null;
  characterName: string | null;
};

export type VitalReport = {
  name: string;
  value: number;
  rating?: string | null;
  route?: string | null;
  nav?: string | null;
  conn?: string | null;
  device?: string | null;
  tz?: string | null;
  lang?: string | null;
  v?: string | null;
};
