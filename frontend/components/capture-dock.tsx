"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { DockShell } from "@/components/dock-shell";
import { Ellipsis } from "@/components/ellipsis";
import { SharpEyesMark } from "@/components/sharp-eyes-mark";
import { COLS, SlotGrid, type SlotItem } from "@/components/slot-grid";
import { apiFetch } from "@/lib/api";
import { invalidate } from "@/lib/cache";
import { compressImage } from "@/lib/compress-image";
import { useDockOpen } from "@/lib/use-dock-open";
import type { Character } from "@/types/character";
import type { ScreenshotResult } from "@/types/screenshot";

// Upload lives here, on the character you are already looking at, rather than on a page of its
// own, and that is not just one page fewer.
//
// The old flow could not know who a screenshot belonged to. It parsed the image, OCR'd the
// character's name out of the HUD, and GUESSED; the whole review step existed to let you correct
// the guess. Uploading from a character's own page removes the ambiguity at source: you have
// already said who it is for. The HUD stops being the answer and becomes a CHECK on the answer,
// which is a much stronger thing to be, if the name in the picture disagrees with the character
// you dropped it on, that is now a contradiction rather than a shrug, and it is worth shouting
// about.
//
// The preview grid is the other half. An upload used to be a leap of faith: it parsed, it wrote,
// and you learned what it did afterwards. Now the parse is shown in the same 16-wide lattice as
// the inventory below it before it is committed, and ONLY the items that changed: the panel below
// already holds the full count, so echoing every unchanged item here would bury the one or two
// lines that actually moved.

type Phase = "reading" | "read" | "error";
type Capture = {
  id: string;
  file: File;
  thumbUrl: string;
  phase: Phase;
  result: ScreenshotResult | null;
  // The held counts as they were the instant this screenshot was dropped, frozen. The diff is
  // against THIS, not the live `stored`: a successful save refetches and pushes `stored` up to the
  // new counts, at which point every delta would collapse to 0 and the preview would show nothing.
  baseline: Map<string, number>;
};

export function CaptureDock({
  characters,
  pinnedCharacterId,
  stored,
  getToken,
  onCharacterAdded,
  onSaved,
  onToggleGeneric,
}: {
  characters: Character[];
  // null = no character selected, so the character is read from the screenshot's HUD instead.
  pinnedCharacterId: string | null;
  // What we already hold for the pinned character, keyed by catalog id. Each capture snapshots
  // this at drop time (see Capture.baseline) so its preview can show the DIFFERENCE.
  stored: Map<string, number>;
  getToken: () => Promise<string | null>;
  onCharacterAdded: (character: Character) => void;
  onSaved: () => void;
  onToggleGeneric: () => void;
}) {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [open, setOpen] = useDockOpen("inventory");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const counter = useRef(0);

  // "Generic" is not a second piece of state that can disagree with the carousel, it IS having
  // no character selected. One truth, so the eye and the carousel can never contradict each other.
  const generic = pinnedCharacterId === null;
  const pinned = characters.find((c) => c.id === pinnedCharacterId);

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.items;
      if (!items) return;
      const files: File[] = [];
      for (const item of items) {
        if (item.kind === "file" && item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
      if (files.length > 0) add(files);
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pinnedCharacterId]);

  function add(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    // Pasting works whether or not the dock is folded, so a paste has to unfold it. The read that
    // follows is the answer to what you just did, and it belongs next to the box it came from.
    if (images.length > 0) setOpen(true);
    for (const file of images) {
      const id = `cap-${counter.current++}`;
      const capture: Capture = {
        id,
        file,
        thumbUrl: URL.createObjectURL(file),
        phase: "reading",
        result: null,
        // Snapshot now, before read()'s POST writes the new counts and the refetch moves `stored`.
        baseline: new Map(stored),
      };
      setCaptures((prev) => [capture, ...prev]);
      read(capture);
    }
  }

  async function read(capture: Capture) {
    const patch = (next: Partial<Capture>) =>
      setCaptures((prev) => prev.map((c) => (c.id === capture.id ? { ...c, ...next } : c)));
    try {
      const { base64, mediaType } = await compressImage(capture.file);
      const body: { imageBase64: string; mediaType: string; characterId?: string } = {
        imageBase64: base64,
        mediaType,
      };
      // Pinning is the point of uploading from a character's page, unless you have said this
      // screenshot is not theirs, in which case we are back to reading the HUD.
      if (pinnedCharacterId) body.characterId = pinnedCharacterId;

      const result = await apiFetch<ScreenshotResult>(
        "/api/screenshots",
        { method: "POST", body: JSON.stringify(body) },
        getToken,
      );
      patch({ phase: "read", result });
      if (result.outcome === "MATCHED") {
        // Counts were written. Anything cached from before is now a wrong number that looks
        // right.
        invalidate("/api/");
        onSaved();
      }
    } catch {
      patch({ phase: "error" });
    }
  }

  async function resolveTo(capture: Capture, characterId: string) {
    if (!capture.result) return;
    await apiFetch(
      `/api/screenshots/${capture.result.screenshotId}/resolve`,
      { method: "POST", body: JSON.stringify({ characterId }) },
      getToken,
    );
    invalidate("/api/");
    onSaved();
    dismiss(capture.id);
  }

  async function ignore(capture: Capture) {
    if (!capture.result) return;
    await apiFetch(
      `/api/screenshots/${capture.result.screenshotId}/ignore`,
      { method: "POST" },
      getToken,
    );
    dismiss(capture.id);
  }

  async function addAndResolve(capture: Capture, name: string) {
    const character = await apiFetch<Character>(
      "/api/characters",
      { method: "POST", body: JSON.stringify({ name }) },
      getToken,
    );
    onCharacterAdded(character);
    await resolveTo(capture, character.id);
  }

  function dismiss(id: string) {
    setCaptures((prev) => {
      const going = prev.find((c) => c.id === id);
      if (going) URL.revokeObjectURL(going.thumbUrl);
      return prev.filter((c) => c.id !== id);
    });
  }

  return (
    <DockShell
      name="inventory"
      open={open}
      onOpenChange={setOpen}
      cards={captures.map((capture) => (
        <CaptureCard
          key={capture.id}
          capture={capture}
          characters={characters}
          onResolve={(id) => resolveTo(capture, id)}
          onIgnore={() => ignore(capture)}
          onAddAndResolve={(name) => addAndResolve(capture, name)}
          onDismiss={() => dismiss(capture.id)}
        />
      ))}
    >
      <div
        className={`dock-drop${dragOver ? " dragover" : ""}${generic ? " generic" : ""}`}
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          add(Array.from(e.dataTransfer.files));
        }}
      >
        {/* Decorative: the text below already says what this is, and the mark repeating
            "SharpEyes" to a screen reader would only be noise. */}
        <span className="dock-drop-mark" aria-hidden="true">
          <SharpEyesMark size={64} />
        </span>
        <span className="dock-drop-main">
          {pinned
            ? `Drop ${pinned.name}'s inventory screenshot here`
            : "Drop an inventory screenshot here"}
        </span>
        <span className="dock-drop-sub">or paste it</span>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            if (e.target.files) add(Array.from(e.target.files));
            e.target.value = "";
          }}
        />

        {/* Turning this on DESELECTS the character in the strip below, and that is the point:
            the two are one state, so what you can see is what will happen. A screenshot cannot be
            both "definitely Bob's" and "work out whose it is". stopPropagation because the whole
            dropzone is a click target for the file picker. */}
        <button
          type="button"
          className={`dock-eye${generic ? " on" : ""}`}
          aria-pressed={generic}
          onClick={(e) => {
            e.stopPropagation();
            onToggleGeneric();
          }}
        >
          <span aria-hidden="true">👁</span>
          <span className="dock-eye-label">
            {generic ? "Reading name from screenshot" : "Read name from screenshot"}
          </span>
        </button>
      </div>
    </DockShell>
  );
}

function CaptureCard({
  capture,
  characters,
  onResolve,
  onIgnore,
  onAddAndResolve,
  onDismiss,
}: {
  capture: Capture;
  characters: Character[];
  onResolve: (characterId: string) => void;
  onIgnore: () => void;
  onAddAndResolve: (name: string) => void;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const result = capture.result;

  async function guard(fn: () => Promise<void> | void) {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  }

  const items: SlotItem[] = (result?.tokenCounts ?? []).map((t) => {
    // tokenCatalogId is null when the parser knows an item the catalog does not. That should not
    // happen (both are generated from catalog/items.yaml) but if it ever does, show the item
    // and skip the comparison rather than dropping it. A silently missing item is the failure
    // this whole app exists to prevent.
    const before = t.tokenCatalogId === null ? undefined : capture.baseline.get(t.tokenCatalogId);
    return {
      id: t.tokenCatalogId ?? t.tokenName,
      name: t.displayName,
      iconUrl: t.iconUrl,
      quantity: t.quantity,
      itemGroup: t.itemGroup,
      // null means "we hold none of this yet", which reads as `new` rather than `+n`, a first
      // sighting is a different thing from a gain. undefined means we cannot say.
      delta:
        t.tokenCatalogId === null ? undefined : before === undefined ? null : t.quantity - before,
    };
  });

  // Only the differences. delta === 0 is the sole "definitely unchanged" case, so it is the only
  // thing dropped: `null` (first sighting, reads as "new") and `undefined` (an item the parser
  // knows but the catalog does not, which must never be silently hidden, that is the failure this
  // app exists to prevent) both stay. On a character's first upload nothing is stored yet, so
  // every item is new and the whole parse still shows, which is exactly right.
  const changed = items.filter((i) => i.delta !== 0);
  const rows = Math.max(1, Math.ceil(changed.length / COLS));

  const { text, tone } = describe(capture);
  const saved = result?.outcome === "MATCHED";
  const note = previewNote(saved, changed.length);

  return (
    <article className={`capture${busy ? " busy" : ""}`}>
      <header className="capture-head">
        <img className="capture-thumb" src={capture.thumbUrl} alt="" />
        <div className="capture-meta">
          <span className={`capture-status ${tone}`}>{text}</span>
          <span className="capture-file">{capture.file.name}</span>
        </div>
        <span className="capture-actions">
          <Actions
            capture={capture}
            characters={characters}
            busy={busy}
            onResolve={(id) => guard(() => onResolve(id))}
            onIgnore={() => guard(onIgnore)}
            onAddAndResolve={(n) => guard(() => onAddAndResolve(n))}
            onDismiss={onDismiss}
            saved={saved}
          />
        </span>
      </header>

      {capture.phase === "read" && items.length > 0 && (
        <div className={`capture-preview${saved ? " saved" : " pending"}`}>
          {changed.length > 0 && <SlotGrid items={changed} rows={rows} />}
          <p className="capture-preview-note">{note}</p>
        </div>
      )}
    </article>
  );
}

function Actions({
  capture,
  characters,
  busy,
  saved,
  onResolve,
  onIgnore,
  onAddAndResolve,
  onDismiss,
}: {
  capture: Capture;
  characters: Character[];
  busy: boolean;
  saved: boolean;
  onResolve: (characterId: string) => void;
  onIgnore: () => void;
  onAddAndResolve: (name: string) => void;
  onDismiss: () => void;
}) {
  const result = capture.result;
  if (capture.phase === "reading")
    return (
      <span className="capture-spinner">
        Reading
        <Ellipsis />
      </span>
    );
  if (capture.phase === "error" || !result) {
    return (
      <button className="link" onClick={onDismiss}>
        Dismiss
      </button>
    );
  }
  if (saved) {
    return (
      <button className="link" onClick={onDismiss} disabled={busy}>
        Done
      </button>
    );
  }

  const detected = result.detectedCharacterName;
  const known = detected
    ? characters.find((c) => c.name.toLowerCase() === detected.toLowerCase())
    : undefined;

  return (
    <>
      {result.outcome === "MISMATCH" && known && (
        <button className="link" disabled={busy} onClick={() => onResolve(known.id)}>
          Save to {known.name}
        </button>
      )}
      {result.outcome === "NEW_CHARACTER_DETECTED" && detected && (
        <button className="link" disabled={busy} onClick={() => onAddAndResolve(detected)}>
          Add {detected}
        </button>
      )}
      {(result.outcome === "UNRESOLVABLE" ||
        result.outcome === "MISMATCH" ||
        result.outcome === "NEW_CHARACTER_DETECTED") && (
        <select
          disabled={busy}
          defaultValue=""
          onChange={(e) => e.target.value && onResolve(e.target.value)}
        >
          <option value="" disabled>
            Save to…
          </option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      <button className="link" disabled={busy} onClick={onIgnore}>
        Discard
      </button>
    </>
  );
}

// The note counts CHANGES, not items read, because the grid now shows only changes.
function previewNote(saved: boolean, changed: number): string {
  const n = `${changed} ${changed === 1 ? "change" : "changes"}`;
  if (changed === 0) return "No changes.";
  return saved ? `${n} saved.` : `${n} to save.`;
}

function describe(capture: Capture): { text: ReactNode; tone: string } {
  if (capture.phase === "reading")
    return {
      text: (
        <>
          Reading the screenshot
          <Ellipsis />
        </>
      ),
      tone: "pending",
    };
  if (capture.phase === "error") return { text: "Upload failed. Try again.", tone: "bad" };

  const r = capture.result!;
  switch (r.outcome) {
    case "MATCHED":
      return { text: `Saved to ${r.detectedCharacterName ?? r.pinnedCharacterName}`, tone: "good" };

    // The HUD now CHECKS the answer instead of supplying it, so a disagreement is a real
    // contradiction and is worded as one. You said this is Bob's; the picture says Alice.
    case "MISMATCH":
      return {
        text: `This is ${r.detectedCharacterName}'s screenshot. Drop it on ${r.detectedCharacterName}.`,
        tone: "bad",
      };

    case "NEW_CHARACTER_DETECTED":
      return {
        text: `${r.detectedCharacterName} isn't one of your characters. Add them first.`,
        tone: "warn",
      };

    // Only reachable with no character selected. Pick one and there is nothing to resolve.
    case "UNRESOLVABLE":
      return {
        text: "No name found. Pick a character.",
        tone: "warn",
      };

    case "UNRECOGNIZED_SCREENSHOT":
      return { text: "Not an inventory screenshot. Upload one.", tone: "bad" };

    case "FAILED":
      return {
        text: r.failureReason ?? "Couldn't read this screenshot. Try another.",
        tone: "bad",
      };

    default:
      return { text: "", tone: "" };
  }
}
