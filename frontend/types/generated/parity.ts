// Every hand-written type in types/ checked against what shared/api serves (generated/api.ts), at
// compile time: tsc fails on any field added, dropped, retyped or made optional on one side only.
// A response must match both ways; a request body only has to be accepted. The differences below
// are the only ones allowed: unions the TypeScript states where the Kotlin keeps a String, and a few
// fields the server always sends that values built in the frontend leave out.

import type * as api from "./api";
import type { Boss, BossClear, BossClearsView, BossPiece } from "@/types/boss";
import type { Character } from "@/types/character";
import type { CharacterToken } from "@/types/character-token";
import type {
  CombineConflict,
  CombinePage,
  CombineSide,
  CombineWith,
  IncomingCombine,
  SeatClash,
  SeatFace,
} from "@/types/combine";
import type { BossDrop, DropTables } from "@/types/drop";
import type {
  AcceptedInvite,
  CreateInviteBody,
  Invite,
  InviteOmission,
  InvitePartyLabel,
  InvitePreview,
} from "@/types/invite";
import type {
  AddLootBody,
  LogDropBody,
  Loot,
  LootBundle,
  LootPayout,
  PartyLootPool,
  SellLootBody,
  SetLootBundlesBody,
  SetLootTakenBody,
  SettleBody,
} from "@/types/loot";
import type { Actor, AppNotification, Notifications } from "@/types/notifications";
import type { DropLogPage, SharedBook } from "@/types/page";
import type { PartiesExtras, PartiesPage } from "@/types/parties-page";
import type {
  Party,
  PartyAccount,
  PartyMember,
  PendingLink,
  Person,
  SavePartyBody,
  SaveSharesBody,
  SavePeopleBody,
  SaveWeekRosterBody,
  SeatedParty,
  SetPartySkipBody,
  SoloDifficultyBody,
} from "@/types/party";
import type { PiecePile, PieceTake, SavePiecePileBody } from "@/types/piece-pile";
import type {
  PieceSync,
  PieceSyncGap,
  PieceSyncGapReason,
  SavePieceSyncBody,
} from "@/types/piece-sync";
import type {
  DetectedBossClear,
  DetectedToken,
  ScreenshotOutcome,
  ScreenshotResult,
} from "@/types/screenshot";
import type { SaveMainCharacterBody, SaveSettingsBody, Settings } from "@/types/settings";
import type { Payer, SettlementListing } from "@/types/settlement-listing";
import type { FriendView, IncomingInvite, SentInvite, Social } from "@/types/social";
import type {
  Group,
  GroupInvitee,
  GroupMember,
  GroupRoster,
  Groups,
  IncomingGroupInvite,
  InvitableFriend,
  InviteToGroupBody,
  SaveGroupBody,
} from "@/types/groups";
import type { TokenCatalogItem } from "@/types/token-catalog";
import type {
  AddProceedsDisposalBody,
  AddSettlementDebtBody,
  AddVestigePaymentBody,
  AddVestigeSettlementBody,
  AddVestigeTrancheBody,
  CloseSettlementBody,
  OffsetShares,
  ProceedsDisposal,
  SettlementDebt,
  SettlementDebtPayout,
  VestigeDisposition,
  VestigePayment,
  VestigeSettlement,
  VestigeTranche,
  VestigeTrancheShare,
} from "@/types/vestige";
import type { Holder } from "@/lib/vestige-ledger";
import type { WorldType } from "@/lib/world";

type Refine<T, R> = Omit<T, keyof R> & R;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Accepted<A, B> = [A] extends [B] ? true : false;
type Is<T extends true> = T;

// The generated responses with the frontend's narrowings applied, innermost first.
type ShareRow = Refine<api.CouponSaleShareRow, { holder: Holder }>;
type Tranche = Refine<
  api.CouponSaleResponse,
  { holder: Holder; disposition: VestigeDisposition; shares: ShareRow[] }
>;
type Payment = Refine<api.PaymentResponse, { holder: Holder }>;
type CouponSettlement = Refine<api.CouponSettlementResponse, { holder: Holder }>;
type Debt = Refine<api.SettlementDebtResponse, { holder: Holder }>;
type HeldMoney = Refine<
  api.HeldMoneyResponse,
  { holder: Holder; kind: "OFFSET" | "PAID"; heldBy?: "YOU" | "THEM" }
>;
// Built without these in lib/shared-book.ts, lib/golden-pages.ts and the fixtures.
type PartyR = Refine<
  api.PartyResponse,
  { worldType: WorldType; invited?: string[]; alreadyPartied?: string[] }
>;
type PersonR = Refine<api.PersonResponse, { contested?: string[] }>;
type CharacterR = Refine<api.CharacterResponse, { worldType: WorldType }>;
type Book = {
  parties: PartyR[];
  tranches: Tranche[];
  payments: Payment[];
  settlements: CouponSettlement[];
  debts: Debt[];
  disposals: HeldMoney[];
};

export type ResponseParity = [
  Is<Same<Boss, api.BossResponse>>,
  Is<Same<BossPiece, api.BossPieceResponse>>,
  Is<Same<BossClear, api.BossClearResponse>>,
  Is<Same<BossClearsView, api.BossClearsViewResponse>>,
  Is<Same<BossDrop, api.BossDropResponse>>,
  Is<Same<DropTables, Record<string, api.BossDropResponse[]>>>,
  Is<Same<Character, CharacterR>>,
  Is<Same<CharacterToken, api.CharacterItemResponse>>,
  Is<Same<TokenCatalogItem, api.ItemCatalogResponse>>,
  Is<Same<SeatFace, api.SeatFace>>,
  Is<Same<CombineSide, api.CombineSideResponse>>,
  Is<Same<CombineConflict, api.CombinePairResponse>>,
  Is<Same<CombineWith, api.CombineWithResponse>>,
  Is<Same<IncomingCombine, api.IncomingCombineResponse>>,
  Is<Same<SeatClash, api.SeatClashResponse>>,
  Is<Same<CombinePage, api.CombinePageResponse>>,
  Is<Same<InviteOmission, api.InviteOmission>>,
  Is<Same<Invite, Refine<api.InviteResponse, { token?: string | null }>>>,
  Is<Same<InvitePartyLabel, api.InvitePartyLabel>>,
  Is<Same<InvitePreview, Refine<api.InvitePreview, { senderSprite?: string | null }>>>,
  Is<Same<AcceptedInvite, api.AcceptedInvite>>,
  Is<Same<LootPayout, api.LootPayoutResponse>>,
  Is<Same<LootBundle, api.LootBundleResponse>>,
  Is<Same<Loot, api.LootResponse>>,
  Is<Same<PartyLootPool, api.PartyLootPoolResponse>>,
  Is<Same<Actor, api.Actor>>,
  Is<Same<AppNotification, Refine<api.NotificationView, { payload: Record<string, unknown> }>>>,
  Is<Same<Notifications, Refine<api.NotificationsResponse, { notifications: AppNotification[] }>>>,
  Is<Same<PartyMember, api.PartyMemberResponse>>,
  Is<Same<PartyAccount, api.PartyAccountResponse>>,
  Is<Same<Party, PartyR>>,
  Is<Same<Person, PersonR>>,
  Is<Same<PendingLink, api.PendingLink>>,
  Is<Same<SeatedParty, Refine<api.SeatedPartyResponse, { party: PartyR }>>>,
  Is<Same<PieceTake, api.PieceTakeResponse>>,
  Is<Same<PiecePile, api.PiecePileResponse>>,
  Is<Same<PieceSyncGap, Refine<api.PieceSyncGapResponse, { reason: PieceSyncGapReason }>>>,
  Is<Same<PieceSync, Refine<api.PieceSyncResponse, { gaps: PieceSyncGap[] }>>>,
  Is<Same<ScreenshotOutcome, api.ScreenshotOutcome>>,
  Is<Same<DetectedToken, api.DetectedItemResponse>>,
  Is<Same<DetectedBossClear, api.DetectedBossClearResponse>>,
  Is<Same<ScreenshotResult, api.ScreenshotResultResponse>>,
  Is<Same<Settings, Refine<api.SettingsResponse, { worldType: WorldType | null }>>>,
  Is<Same<SettlementListing, Refine<api.SettlementListingView, { payer: Payer }>>>,
  Is<Same<FriendView, api.FriendView>>,
  Is<Same<Social, api.SocialResponse>>,
  Is<Same<IncomingInvite, api.IncomingInviteView>>,
  Is<Same<SentInvite, api.SentInviteView>>,
  Is<Same<GroupMember, api.GroupMemberView>>,
  Is<Same<GroupInvitee, api.GroupInviteeView>>,
  Is<Same<Group, api.GroupView>>,
  Is<Same<IncomingGroupInvite, api.IncomingGroupInviteView>>,
  Is<Same<Groups, api.GroupsResponse>>,
  Is<Same<InvitableFriend, api.InvitableFriendView>>,
  Is<Same<GroupRoster, api.GroupRosterResponse>>,
  Is<Same<VestigeTrancheShare, ShareRow>>,
  Is<Same<VestigeTranche, Tranche>>,
  Is<Same<VestigePayment, Payment>>,
  Is<Same<VestigeSettlement, CouponSettlement>>,
  Is<Same<SettlementDebt, Debt>>,
  Is<Same<SettlementDebtPayout, api.SettlementDebtPayoutRow>>,
  Is<Same<ProceedsDisposal, HeldMoney>>,
  Is<
    Same<OffsetShares, Refine<api.OffsetSharesResponse, { debts: Debt[]; disposals: HeldMoney[] }>>
  >,
  Is<
    Same<
      DropLogPage,
      Refine<api.DropLogPageResponse, Book & { characters: CharacterR[]; people: PersonR[] }>
    >
  >,
  Is<Same<SharedBook, Refine<api.SharedPartiesResponse, Book>>>,
  Is<
    Same<
      PartiesPage,
      Refine<api.PartiesPageResponse, { parties: PartyR[]; characters: CharacterR[] }>
    >
  >,
  Is<
    Same<
      PartiesExtras,
      Refine<
        api.PartiesExtrasResponse,
        {
          settlements: CouponSettlement[];
          seated: Refine<api.SeatedPartyResponse, { party: PartyR }>[];
          people: PersonR[];
        }
      >
    >
  >,
];

export type RequestParity = [
  Is<Accepted<CreateInviteBody, api.CreateInviteRequest>>,
  Is<Accepted<AddLootBody, api.AddLootRequest>>,
  Is<Accepted<LogDropBody, api.LogDropRequest>>,
  Is<Accepted<SellLootBody, api.SellLootRequest>>,
  Is<Accepted<SetLootTakenBody, api.TakenRequest>>,
  Is<Accepted<SetLootBundlesBody, api.LootBundlesRequest>>,
  Is<Accepted<SettleBody, api.SettleRequest>>,
  Is<Accepted<SavePartyBody, api.SavePartyRequest>>,
  Is<Accepted<SaveSharesBody, api.SaveSharesRequest>>,
  Is<Accepted<SoloDifficultyBody, api.SetSoloDifficultyRequest>>,
  Is<Accepted<SaveWeekRosterBody, api.SaveWeekRosterRequest>>,
  Is<Accepted<SetPartySkipBody, api.SetPartySkipRequest>>,
  Is<Accepted<SavePeopleBody, api.SavePeopleRequest>>,
  Is<Accepted<SavePiecePileBody, api.SavePiecePileRequest>>,
  Is<Accepted<SavePieceSyncBody, api.SavePieceSyncRequest>>,
  Is<Accepted<SaveSettingsBody, api.SaveSettingsRequest>>,
  Is<Accepted<SaveMainCharacterBody, api.SaveMainCharacterRequest>>,
  Is<Accepted<AddVestigeTrancheBody, api.AddCouponSaleRequest>>,
  Is<Accepted<AddVestigePaymentBody, api.AddPaymentRequest>>,
  Is<Accepted<AddVestigeSettlementBody, api.AddCouponSettlementRequest>>,
  Is<Accepted<AddSettlementDebtBody, api.AddSettlementDebtRequest>>,
  Is<Accepted<CloseSettlementBody, api.OffsetSharesRequest>>,
  Is<Accepted<AddProceedsDisposalBody, api.AddHeldMoneyRequest>>,
  Is<Accepted<SaveGroupBody, api.SaveGroupRequest>>,
  Is<Accepted<InviteToGroupBody, api.InviteToGroupRequest>>,
];
