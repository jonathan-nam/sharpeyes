"use client";

import { type DependencyList, useEffect, useState } from "react";

import type { PileForm } from "@/components/piece-pile";
import { apiFetch } from "@/lib/api";
import { draftPile } from "@/lib/piece-pile";
import { pooledPieceAt } from "@/lib/piece-stacks";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";
import type { PiecePile, SavePiecePileBody } from "@/types/piece-pile";

const PILES_KEY = "/api/parties/pieces";

/** The week's pile on one party, added or to add. What PartyCard and DropPicker are handed. */
export type PiecePileSlot = {
  form: PileForm;
  onSave: (total: number, takes: Record<string, number>) => Promise<void>;
  onRemove: () => Promise<void>;
};

/**
 * One week's piles of Eternal pieces, for every screen whose drop picker offers one.
 *
 * Shared so Party View and Run Order cannot disagree about whether a party drops a pile.
 */
export function usePiecePiles({
  getToken,
  isLoaded,
  week,
  weekStart,
  bosses,
  reload,
}: {
  getToken: () => Promise<string | null>;
  isLoaded: boolean;
  /** The week asked for, or null for the live one. */
  week: string | null;
  /** The week a pile is written to. Null while unknown, which offers no pile. */
  weekStart: string | null;
  bosses: Boss[];
  /** Re-read whenever any of these change: every write that could re-file a pile. */
  reload: DependencyList;
}) {
  const [piles, setPiles] = useState<PiecePile[]>([]);
  useEffect(() => {
    if (!isLoaded) return;
    let cancelled = false;
    apiFetch<PiecePile[]>(
      week ? `${PILES_KEY}?week=${week}` : PILES_KEY,
      { method: "GET" },
      getToken,
    )
      .then((result) => {
        if (!cancelled) setPiles(result);
      })
      .catch(() => {
        /* keep what we have */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...reload, week, isLoaded]);

  async function writePile(party: Party, init: RequestInit, query = "") {
    const result = await apiFetch<PiecePile | PiecePile[]>(
      `/api/parties/${party.id}/pieces${query}`,
      init,
      getToken,
    );
    const fresh = Array.isArray(result) ? result : [result];
    setPiles((current) => current.filter((p) => p.partyId !== party.id).concat(fresh));
  }

  /**
   * The week's pile on this party: the one added, or an Add form opened on what the config's mode
   * drops and its piece ratio, where the party drops a pooled pile at all.
   */
  function piecePileFor(party: Party): PiecePileSlot | undefined {
    const pile = piles.find((p) => p.partyId === party.id);
    const piece = pooledPieceAt(
      bosses.find((b) => b.bossKey === party.bossKey) ?? null,
      party.difficulty ?? "",
      party.worldType,
    );
    if (weekStart === null || (!pile && !piece)) return undefined;
    const draft = piece ? draftPile(party, piece) : null;
    const form: PileForm = pile
      ? {
          tokenName: pile.tokenName,
          iconUrl: pile.iconUrl,
          difficulty: pile.difficulty,
          stackSize: pile.stackSize,
          total: pile.total,
          takes: pile.takes.map((t) => [t.memberId, t.quantity]),
          added: true,
        }
      : {
          tokenName: piece!.tokenName,
          iconUrl: piece!.iconUrl,
          difficulty: party.difficulty!,
          stackSize: piece!.stackSize,
          total: draft!.total,
          takes: Object.entries(draft!.takes),
          added: false,
        };
    return {
      form,
      onSave: (total, takes) => {
        const body: SavePiecePileBody = { weekStart, total, takes };
        return writePile(party, { method: "PUT", body: JSON.stringify(body) });
      },
      onRemove: () => writePile(party, { method: "DELETE" }, `?week=${weekStart}`),
    };
  }

  return { piecePileFor };
}
