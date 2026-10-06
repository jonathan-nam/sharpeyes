"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { Field } from "@/components/add-field";
import { DropSelect } from "@/components/drop-select";
import { StackAssign } from "@/components/stack-assign";
import { StackPickupDraft } from "@/components/stack-pickup";
import { OTHER, addDropBody, defaultQuantity, pickableDrops } from "@/lib/drop-picker";
import { draftBoxes, draftDrop, draftStacks } from "@/lib/vestige-pickup";
import type { ShareConfig } from "@/lib/vestige-stacks";
import type { WorldType } from "@/lib/world";
import type { BossDrop } from "@/types/drop";
import type { AddLootBody } from "@/types/loot";
import type { Party } from "@/types/party";

/**
 * The stacking drop's own two blocks, answerable in the form that is about to log it.
 *
 * Only this form gets them. The Drop Log's picker resolves its pool on the server, so there is no
 * party in hand to split anything by, and the party's own page reads its rows rather than answering
 * for them.
 */
export type StackDraft = {
  /** The drop the blocks are about. They appear only when it is the one picked. */
  dropKey: string;
  config: ShareConfig;
  party: Party;
  /** Each holder's position across what is already recorded, so the odd stack rotates. */
  behind: Map<string, number>;
  pickupTitle: string;
  entitledTitle: string;
  /**
   * The standing split's own write, which is the party's and lands on its own button.
   *
   * Absent where the screen states the split rather than answering it, which draws it read-only.
   */
  onSaveShares?: (shares: Map<string, number>) => Promise<void>;
};

// Log a drop. Carried by the party's loot pool, by a row on Party View and by the Drop Log's own
// form, the same component in all three so no two can offer different drops for the same boss.
//
// The item comes from the boss's own drop table (catalog/drops.yaml) rather than a text box,
// because a pool full of "grindstone", "Grindstone" and "grindstone of faith" is a pool you cannot
// count. Anything the tables do not list is still typeable.
//
// The boss is not a control here: a pool belongs to a config, and a config IS one boss. A caller
// that has to ask which boss (the Drop Log does, since it covers all of them) asks in `lead`, and
// the answer arrives as `bossKey`. Nor is it drawn: every screen carrying this form already names
// the boss above it.

export function DropPicker({
  bossKey,
  worldType,
  table,
  busy,
  lead,
  card,
  difficulty,
  draft,
  onPick,
  onAdd,
}: {
  /** Which boss this drop is for. Empty until a caller that asks has an answer. */
  bossKey: string;
  /**
   * The mode this party runs. It decides what the list may offer, since a boss's counted drops
   * change with the mode (see pickableDrops), and how many pieces a stacking drop arrives in.
   * Absent, or null where nobody has said, narrows nothing and fills nothing.
   */
  difficulty?: string | null;
  /** Whose world the drop fell in. Narrowing the table to it is pickableDrops' job, not a caller's. */
  worldType: WorldType;
  /** This boss's whole table. */
  table: BossDrop[] | undefined;
  busy: boolean;
  /** Controls the caller needs answered first, inside this form so there is one submit. */
  lead?: ReactNode;
  /**
   * The Drop Log's own presentation: a card of labelled boxes submitted by a +, the shape Add Party
   * has on the parties page. Everywhere else this form is a plain row inside a card the caller has
   * already drawn, where a second card would be a box around nothing and a bare + would sit under
   * the full-width stack blocks with nothing naming it.
   *
   * A caller passing this labels its own `lead` boxes. This one cannot name controls it is handed.
   */
  card?: boolean;
  /**
   * The stacking drop's blocks, answerable here. Absent on every picker that has no party to split by.
   *
   * The pickup goes out WITH the drop, in one request, because it is keyed to a row that does not
   * exist until this form creates one. The split is the party's own standing deal and keeps its own
   * Save, since it outlives the night being logged.
   */
  draft?: StackDraft;
  /**
   * What is picked, for a caller that draws something of its own about it.
   *
   * Party View's panel needs it to stop drawing the standing split while this form is drawing an
   * editable copy: two of them, each with a Save, is two answers to one question.
   */
  onPick?: (dropKey: string) => void;
  /**
   * Rejecting keeps what was picked on screen, so a failed save can be retried without choosing
   * again. Callers that report the failure themselves reject; the loot pool handles its own and
   * does not.
   */
  onAdd: (body: AddLootBody) => void | Promise<void>;
}) {
  const [dropKey, setDropKey] = useState("");
  const [customName, setCustomName] = useState("");
  const [quantity, setQuantity] = useState("");
  // The draft's boxes live here rather than in the block drawing them, so what is on screen and what
  // the submit sends are one value instead of two that have to be kept level.
  const [boxes, setBoxes] = useState<Record<string, string>>({});

  const drops = pickableDrops(table, worldType, difficulty);
  const body = addDropBody(bossKey, dropKey, customName, quantity);

  // The night about to be logged, when the picked drop is the one that stacks. Rebuilt from the
  // count as typed, so changing it re-reads the stacks against what actually fell.
  const night =
    draft && dropKey === draft.dropKey
      ? draftDrop(draft.config, body?.quantity ?? 0, draft.behind)
      : null;
  const stacks = night ? draftStacks(night, boxes) : null;
  // An arrangement that does not add up is not sent at all: the server refuses one, and refusing it
  // now takes the DROP down with it, so the form holds it back rather than losing both.
  const ready = Boolean(body) && (night === null || stacks !== null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body || busy || !ready) return;
    try {
      // Empty is a night nobody has answered for, which is what a drop logged anywhere else
      // is, so nothing is sent rather than an empty map.
      await onAdd(stacks && Object.keys(stacks).length > 0 ? { ...body, bundles: stacks } : body);
    } catch {
      return;
    }
    setDropKey("");
    onPick?.("");
    setCustomName("");
    setQuantity("");
    setBoxes({});
  }

  /* Both blocks the coupon row carries, before there is a row to carry them. Inside the form and
     ABOVE its button, because the pickup goes out with Add drop and a button that submits what is
     under it reads as belonging to the line it is on instead.

     The split keeps its own Save: it is the party's standing deal, it outlives this night, and it
     is already saved that way everywhere else. */
  const blocks = night && draft && (
    <div className="loot-draft">
      <h4 className="loot-group-title is-config">{draft.pickupTitle}</h4>
      <StackPickupDraft drop={night} boxes={boxes} busy={busy} onChange={setBoxes} />

      <h4 className="loot-group-title is-config">{draft.entitledTitle}</h4>
      <StackAssign config={draft.config} editing busy={busy} onSave={draft.onSaveShares} />
    </div>
  );

  const fields = (
    <>
      {lead}

      <Field on={Boolean(card)} label="Drop" cls="is-drop">
        <DropSelect
          drops={drops}
          worldType={worldType}
          value={dropKey}
          label="Which drop"
          onChange={(picked) => {
            setDropKey(picked);
            onPick?.(picked);
            // Filled from the catalog on every change of drop, including back to nothing, so the
            // count belongs to what is currently picked. Typing over it stands: nothing refills a
            // box after this, which is what makes it a default rather than a value.
            const count = defaultQuantity(
              drops.find((d) => d.dropKey === picked),
              difficulty,
              worldType,
            );
            setQuantity(count);
            // The stack boxes open on the same suggestion the recorded ones do, and clear with any
            // other drop. A suggestion, not an answer: emptying them logs the night unanswered.
            const opening =
              draft && picked === draft.dropKey
                ? draftDrop(draft.config, Number(count) || 0, draft.behind)
                : null;
            setBoxes(opening ? draftBoxes(opening) : {});
          }}
        />
      </Field>

      {dropKey === OTHER && (
        <Field on={Boolean(card)} label="Name" cls="is-wide">
          <input
            className="split-input"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            placeholder={card ? undefined : "what dropped"}
            aria-label={card ? undefined : "Item name"}
            maxLength={80}
          />
        </Field>
      )}

      {dropKey !== "" && (
        <Field on={Boolean(card)} label="How many" cls="is-narrow">
          <input
            className="split-input loot-count-input"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="1"
            aria-label={card ? undefined : "How many"}
            inputMode="numeric"
            maxLength={7}
          />
        </Field>
      )}

      {blocks}

      {card ? (
        <button
          type="submit"
          className="party-save add-plus"
          title="Add drop"
          aria-label="Add drop"
          disabled={busy || !ready}
        >
          <span aria-hidden="true">+</span>
        </button>
      ) : (
        <button type="submit" className="party-save" disabled={busy || !ready}>
          Add drop
        </button>
      )}
    </>
  );

  return (
    <>
      {card ? (
        <form className="add-card" onSubmit={submit}>
          <div className="add-fields">{fields}</div>
        </form>
      ) : (
        <form className="loot-add" onSubmit={submit}>
          {fields}
        </form>
      )}

      {/* The "only drops in Interactive worlds" note that used to sit here is gone: the list is
          now narrowed to this party's world and mode, so anything still on it does drop here.

          On the TABLE rather than on what survived the filters, so the sentence stays true: a boss
          whose table is all counted rows could narrow down to nothing at some mode, and that is not
          a boss with no table. */}
      {(table?.length ?? 0) === 0 && bossKey !== "" && (
        <p className="party-hint">
          No drop table recorded for this boss yet, so pick “something else” and type it.
        </p>
      )}
    </>
  );
}
