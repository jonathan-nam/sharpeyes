"use client";

import { useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import { difficultyLabel } from "@/lib/boss-difficulty";
import { parseCount, pileProblem } from "@/lib/piece-pile";
import type { Party } from "@/types/party";
import type { PiecePile } from "@/types/piece-pile";

/**
 * One week's pile of Eternal pieces on a party, and what each seat took of it.
 *
 * Opens on what the clear filed from the config. Saving makes it that week's record, which nothing
 * re-files until it is reset.
 */
export function PiecePileEditor({
  party,
  pile,
  busy,
  onSave,
  onReset,
}: {
  party: Party;
  pile: PiecePile;
  busy: boolean;
  onSave: (total: number, takes: Record<string, number>) => Promise<void>;
  onReset: () => Promise<void>;
}) {
  const nameOf = new Map(party.seats.map((s) => [s.id, s.name]));
  const saved = Object.fromEntries(pile.takes.map((t) => [t.memberId, String(t.quantity)]));
  const [total, setTotal] = useState(String(pile.total));
  const [takes, setTakes] = useState<Record<string, string>>(saved);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    total !== String(pile.total) ||
    pile.takes.some((t) => takes[t.memberId] !== String(t.quantity));
  const problem = pileProblem(
    parseCount(total),
    pile.takes.map((t) => parseCount(takes[t.memberId] ?? "")),
    pile.stackSize,
  );

  async function run(write: () => Promise<void>) {
    setError(null);
    try {
      await write();
    } catch {
      setError("That didn't save.");
    }
  }

  return (
    <section className="config-section config-panel piece-pile">
      <div className="config-panel-head">
        {pile.iconUrl && <img className="loot-icon" src={apiAssetUrl(pile.iconUrl)} alt="" />}
        <h4 className="loot-group-title is-config">{pile.tokenName}</h4>
        <span className="piece-pile-mode">{difficultyLabel(pile.difficulty)}</span>
      </div>
      <div className="config-shares">
        <label className="config-share">
          Dropped
          <input
            className="split-input"
            value={total}
            inputMode="numeric"
            onChange={(e) => setTotal(e.target.value)}
            aria-label={`${pile.tokenName} dropped`}
            disabled={busy}
          />
        </label>
        {pile.takes.map((t) => (
          <label className="config-share" key={t.memberId}>
            {nameOf.get(t.memberId) ?? "?"}
            <input
              className="split-input"
              value={takes[t.memberId] ?? ""}
              inputMode="numeric"
              onChange={(e) => setTakes({ ...takes, [t.memberId]: e.target.value })}
              aria-label={`${pile.tokenName} ${nameOf.get(t.memberId) ?? ""} took`}
              disabled={busy}
            />
          </label>
        ))}
      </div>
      {dirty && problem && <p className="split-error">{problem}</p>}
      {error && <p className="split-error">{error}</p>}
      {(dirty || pile.edited) && (
        <div className="loot-actions">
          {dirty && (
            <button
              type="button"
              className="party-save"
              disabled={busy || problem !== null}
              onClick={() =>
                run(() =>
                  onSave(
                    parseCount(total)!,
                    Object.fromEntries(
                      pile.takes.map((t) => [t.memberId, parseCount(takes[t.memberId] ?? "")!]),
                    ),
                  ),
                )
              }
            >
              Save
            </button>
          )}
          {dirty ? (
            <button
              type="button"
              className="party-cancel"
              disabled={busy}
              onClick={() => {
                setTotal(String(pile.total));
                setTakes(saved);
              }}
            >
              Revert
            </button>
          ) : (
            <button
              type="button"
              className="party-cancel"
              disabled={busy}
              onClick={() => run(onReset)}
            >
              Use config split
            </button>
          )}
        </div>
      )}
    </section>
  );
}
