"use client";

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { StaleAfterWrite } from "@/lib/api";

// One Save for every block an Edit opens. Each block says whether it holds an answer and whether
// that answer can be saved; the owner's button writes the ones that changed, in the order they
// registered.

/** One block's unsaved answer. */
export type SaveSlot = {
  /** Something typed that is not what is on file. */
  changed: boolean;
  /** What is typed can be sent. Only asked of a changed block. */
  ready: boolean;
  /** Rejects when it did not land. */
  save: () => Promise<void>;
};

type Registry = {
  saving: boolean;
  put: (id: string, slot: SaveSlot | null) => void;
};

const SaveGroupContext = createContext<Registry | null>(null);

export type SaveGroupState = {
  changed: boolean;
  ready: boolean;
  saving: boolean;
  /**
   * Writes every changed block, stopping at the first refusal. A write that landed and could not be
   * read back is still a save, so the rest go on and StaleAfterWrite is thrown at the end.
   */
  saveAll: () => Promise<void>;
  registry: Registry;
};

export function useSaveGroup(): SaveGroupState {
  const slots = useRef(new Map<string, SaveSlot>());
  const [flags, setFlags] = useState({ changed: false, ready: true });
  const [saving, setSaving] = useState(false);

  const put = useCallback((id: string, slot: SaveSlot | null) => {
    if (slot) slots.current.set(id, slot);
    else slots.current.delete(id);
    const changed = [...slots.current.values()].filter((s) => s.changed);
    const next = { changed: changed.length > 0, ready: changed.every((s) => s.ready) };
    setFlags((was) => (was.changed === next.changed && was.ready === next.ready ? was : next));
  }, []);

  const saveAll = useCallback(async () => {
    setSaving(true);
    let stale: StaleAfterWrite | null = null;
    try {
      for (const slot of [...slots.current.values()]) {
        if (!slot.changed) continue;
        try {
          await slot.save();
        } catch (e) {
          if (!(e instanceof StaleAfterWrite)) throw e;
          stale = e;
        }
      }
    } finally {
      setSaving(false);
    }
    if (stale) throw stale;
  }, []);

  const registry = useMemo(() => ({ saving, put }), [saving, put]);
  return { ...flags, saving, saveAll, registry };
}

export function SaveGroup({ group, children }: { group: SaveGroupState; children: ReactNode }) {
  return <SaveGroupContext.Provider value={group.registry}>{children}</SaveGroupContext.Provider>;
}

/** Joins the nearest group. Returns whether it is saving, so the block can hold its boxes still. */
export function useSaveSlot(slot: SaveSlot): boolean {
  const group = useContext(SaveGroupContext);
  const id = useId();
  const latest = useRef(slot);
  const put = group?.put;

  useEffect(() => {
    latest.current = slot;
  });
  useEffect(() => {
    put?.(id, { changed: slot.changed, ready: slot.ready, save: () => latest.current.save() });
  }, [put, id, slot.changed, slot.ready]);
  useEffect(() => () => put?.(id, null), [put, id]);

  return group?.saving ?? false;
}
