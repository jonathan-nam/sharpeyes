"use client";

import { useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import { difficultyLabel } from "@/lib/boss-difficulty";
import { parseCount, pileProblem } from "@/lib/piece-pile";
import type { Party } from "@/types/party";

/** What the form is about: the pile already added, or the one the config would add. */
export type PileForm = {
  tokenName: string;
  iconUrl: string | null;
  difficulty: string;
  stackSize: number;
  total: number;
  // Seat id to pieces, in the order the seats are drawn.
  takes: [string, number][];
  // False for one being added from the Add Drop list.
  added: boolean;
};

/**
 * One week's pile of Eternal pieces on a party, and what each seat took of it.
 *
 * Added by hand from the Add Drop list, as a party's coupons are. How many fall is fixed by the boss and
 * mode, so only the split is edited: it opens on the config's piece ratio.
 */
export function PiecePileEditor({
  party,
  form,
  busy,
  onSave,
  onRemove,
  onCancel,
}: {
  party: Party;
  form: PileForm;
  busy: boolean;
  onSave: (total: number, takes: Record<string, number>) => Promise<void>;
  /** For a pile already added. */
  onRemove?: () => Promise<void>;
  /** For one being added from the Add Drop list, which puts the list back. */
  onCancel?: () => void;
}) {
  const nameOf = new Map(party.seats.map((s) => [s.id, s.name]));
  const saved = Object.fromEntries(form.takes.map(([id, n]) => [id, String(n)]));
  const [takes, setTakes] = useState<Record<string, string>>(saved);
  const [error, setError] = useState<string | null>(null);

  const dirty = form.takes.some(([id, n]) => takes[id] !== String(n));
  const problem = pileProblem(
    form.total,
    form.takes.map(([id]) => parseCount(takes[id] ?? "")),
    form.stackSize,
  );

  async function run(write: () => Promise<void>) {
    setError(null);
    try {
      await write();
    } catch {
      setError("That didn't save. Try again.");
    }
  }

  const save = () =>
    run(() =>
      onSave(
        form.total,
        Object.fromEntries(form.takes.map(([id]) => [id, parseCount(takes[id] ?? "")!])),
      ),
    );

  return (
    <section className="config-section config-panel piece-pile">
      <div className="config-panel-head">
        {form.iconUrl && <img className="loot-icon" src={apiAssetUrl(form.iconUrl)} alt="" />}
        <h4 className="loot-group-title is-config">{form.tokenName}</h4>
        <span className="piece-pile-mode">{difficultyLabel(form.difficulty)}</span>
      </div>
      <div className="config-shares">
        {form.takes.map(([id]) => (
          <label className="config-share" key={id}>
            {nameOf.get(id) ?? "?"}
            <input
              className="split-input"
              value={takes[id] ?? ""}
              inputMode="numeric"
              onChange={(e) => setTakes({ ...takes, [id]: e.target.value })}
              aria-label={`${form.tokenName} ${nameOf.get(id) ?? ""} took`}
              disabled={busy}
            />
          </label>
        ))}
      </div>
      {problem && <p className="split-error">{problem}</p>}
      {error && <p className="split-error">{error}</p>}
      <div className="loot-actions">
        {form.added ? (
          <>
            {dirty && (
              <button
                type="button"
                className="party-save"
                disabled={busy || problem !== null}
                onClick={save}
              >
                Save
              </button>
            )}
            {dirty && (
              <button
                type="button"
                className="party-cancel"
                disabled={busy}
                onClick={() => setTakes(saved)}
              >
                Revert
              </button>
            )}
            {onRemove && (
              <button
                type="button"
                className="party-delete"
                disabled={busy}
                onClick={() => run(onRemove)}
              >
                Remove
              </button>
            )}
          </>
        ) : (
          <>
            <button
              type="button"
              className="party-save"
              disabled={busy || problem !== null}
              onClick={save}
            >
              Add
            </button>
            <button type="button" className="party-cancel" disabled={busy} onClick={onCancel}>
              Cancel
            </button>
          </>
        )}
      </div>
    </section>
  );
}
