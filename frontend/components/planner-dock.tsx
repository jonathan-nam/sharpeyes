"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { CharacterPicker } from "@/components/character-picker";
import { DockShell } from "@/components/dock-shell";
import { Ellipsis } from "@/components/ellipsis";
import { SharpEyesMark } from "@/components/sharp-eyes-mark";
import { apiFetch } from "@/lib/api";
import { clearStateLabel } from "@/lib/boss-clears";
import { invalidate } from "@/lib/cache";
import { compressImage } from "@/lib/compress-image";
import { clearedCount, describeCaveat, hasPlanner, plannerCaveats } from "@/lib/planner-capture";
import { useDockOpen } from "@/lib/use-dock-open";
import type { Character } from "@/types/character";
import type { ScreenshotResult } from "@/types/screenshot";

// The planner panel does not contain the character's name. vision/app/cv/planner.py reads boss
// rows and nothing else, and the only name source is the in-game HUD, which a cropped planner
// capture does not include. So the character cannot be inferred here the way the inventory dock
// can infer it, and a capture dropped with nobody selected comes back UNRESOLVABLE with nothing
// saved (backend screenshots/ScreenshotIngestion.kt, decideOutcome).
//
// Rather than let that happen and explain it afterwards, the dock will not accept an image until
// a character is chosen. The choice is the first thing in the flow, not a field beside it.

type Phase = "reading" | "read" | "error";
type Capture = {
  id: string;
  file: File;
  thumbUrl: string;
  phase: Phase;
  result: ScreenshotResult | null;
  // Who it was dropped on, frozen at drop time. The selector can move while a read is in flight,
  // and the card must keep saying who this one went to.
  characterName: string;
};

export function PlannerDock({
  characters,
  selectedCharacterId,
  onSelectCharacter,
  getToken,
  onSaved,
}: {
  characters: Character[];
  // null = nothing chosen yet, which is why the dropzone is disabled.
  selectedCharacterId: string | null;
  onSelectCharacter: (id: string | null) => void;
  getToken: () => Promise<string | null>;
  onSaved: () => void;
}) {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [open, setOpen] = useDockOpen("planner");

  const fileInputRef = useRef<HTMLInputElement>(null);
  const counter = useRef(0);

  const selected = characters.find((c) => c.id === selectedCharacterId);

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      // Pasting with nobody selected would be silently ignored, which reads as the paste not
      // working. Let it through to add(), which explains itself.
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
  }, [selectedCharacterId, characters]);

  const [refused, setRefused] = useState(false);

  function add(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0) return;
    // Unfold first, and unconditionally: pasting works while folded, and both answers to a paste
    // (the read, or the refusal below) are inside the fold.
    setOpen(true);
    if (!selected) {
      setRefused(true);
      return;
    }
    setRefused(false);
    for (const file of images) {
      const id = `plan-${counter.current++}`;
      const capture: Capture = {
        id,
        file,
        thumbUrl: URL.createObjectURL(file),
        phase: "reading",
        result: null,
        characterName: selected.name,
      };
      setCaptures((prev) => [capture, ...prev]);
      read(capture, selected.id);
    }
  }

  async function read(capture: Capture, characterId: string) {
    const patch = (next: Partial<Capture>) =>
      setCaptures((prev) => prev.map((c) => (c.id === capture.id ? { ...c, ...next } : c)));
    try {
      const { base64, mediaType } = await compressImage(capture.file);
      const result = await apiFetch<ScreenshotResult>(
        "/api/screenshots",
        {
          method: "POST",
          body: JSON.stringify({ imageBase64: base64, mediaType, characterId }),
        },
        getToken,
      );
      patch({ phase: "read", result });
      if (result.outcome === "MATCHED") {
        // Clears were written, so anything cached from before is now a wrong number that looks
        // right.
        invalidate("/api/");
        onSaved();
      }
    } catch {
      patch({ phase: "error" });
    }
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
      name="planner"
      open={open}
      onOpenChange={setOpen}
      cards={captures.map((capture) => (
        <PlannerCard key={capture.id} capture={capture} onDismiss={() => dismiss(capture.id)} />
      ))}
    >
      <div className="planner-pick">
        <CharacterPicker
          characters={characters}
          selectedId={selectedCharacterId}
          onSelect={(id) => {
            onSelectCharacter(id);
            setRefused(false);
          }}
        />
      </div>

      <div
        className={`dock-drop${dragOver ? " dragover" : ""}${selected ? "" : " disabled"}`}
        onClick={() => (selected ? fileInputRef.current?.click() : setRefused(true))}
        onDragOver={(e) => {
          e.preventDefault();
          if (selected) setDragOver(true);
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
          {selected
            ? `Drop ${selected.name}'s Maple Planner screenshot here`
            : "Choose a character first"}
        </span>
        {selected && <span className="dock-drop-sub">or paste it</span>}
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
      </div>

      {refused && !selected && (
        <p className="planner-refused" role="alert">
          No character chosen. Pick one first.
        </p>
      )}
    </DockShell>
  );
}

function PlannerCard({ capture, onDismiss }: { capture: Capture; onDismiss: () => void }) {
  const result = capture.result;
  const { text, tone } = describe(capture);

  const planner = result && hasPlanner(result);
  const caveats = result ? plannerCaveats(result) : [];

  return (
    <article className="capture">
      <header className="capture-head">
        <img className="capture-thumb" src={capture.thumbUrl} alt="" />
        <div className="capture-meta">
          <span className={`capture-status ${tone}`}>{text}</span>
          <span className="capture-file">{capture.file.name}</span>
        </div>
        <span className="capture-actions">
          {capture.phase === "reading" ? (
            <span className="capture-spinner">
              Reading
              <Ellipsis />
            </span>
          ) : (
            <button className="link" onClick={onDismiss}>
              {result?.outcome === "MATCHED" ? "Done" : "Dismiss"}
            </button>
          )}
        </span>
      </header>

      {capture.phase === "read" && result && planner && (
        <div className={`capture-preview${result.outcome === "MATCHED" ? " saved" : " pending"}`}>
          {result.bossClears.length > 0 && (
            <ul className="planner-clears">
              {result.bossClears.map((c) => (
                <li key={c.bossKey} className={c.cleared ? "is-cleared" : "is-pending"}>
                  <span aria-hidden="true">{c.cleared ? "✓" : "·"}</span>
                  {c.displayName}
                  <span className="visually-hidden">{` ${clearStateLabel(c.cleared)}`}</span>
                </li>
              ))}
            </ul>
          )}

          <p className="capture-preview-note">
            {result.bossClears.length === 0
              ? "No bosses found. Upload the boss list."
              : `${clearedCount(result)} of ${result.bossClears.length} cleared.`}
          </p>

          {/* Caveats sit under the clears rather than replacing them: the rows that WERE read are
              still good, and the point is that they are not the whole story. */}
          {caveats.map((caveat) => (
            <p key={caveat} className="planner-caveat">
              {describeCaveat(caveat, result.unreadableBossRows ?? 0)}
            </p>
          ))}
        </div>
      )}
    </article>
  );
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
      // A capture can be MATCHED on its inventory half while holding no planner at all, so the
      // saved message must not promise clears that were never in the picture.
      return hasPlanner(r)
        ? { text: `Saved to ${capture.characterName}`, tone: "good" }
        : {
            text: `Saved to ${capture.characterName}. Upload the planner separately.`,
            tone: "warn",
          };

    // The HUD disagreed with the character that was picked. Nothing was saved, and on this page
    // the pick is the only thing that could be wrong.
    case "MISMATCH":
      return {
        text: `This is ${r.detectedCharacterName}'s screenshot. Pick ${r.detectedCharacterName} instead.`,
        tone: "bad",
      };

    case "NEW_CHARACTER_DETECTED":
      return {
        text: `${r.detectedCharacterName} isn't one of your characters. Add them first.`,
        tone: "warn",
      };

    case "UNRESOLVABLE":
      return { text: "No character chosen. Pick one first.", tone: "bad" };

    case "UNRECOGNIZED_SCREENSHOT":
      return { text: "Not a Maple Planner screenshot. Upload one.", tone: "bad" };

    case "FAILED":
      return {
        text: r.failureReason ?? "Couldn't read this screenshot. Try another.",
        tone: "bad",
      };

    default:
      return { text: "", tone: "" };
  }
}
