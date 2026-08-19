"use client";

import { useAuth } from "@/lib/use-auth";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Character } from "@/types/character";

// Adding a character: a name, and nothing else to ask for.
//
// Level, job and sprite are looked up from the name, and the row this adds shows all three the
// moment it lands, which is why there is no note here saying so.
//
// This used to be the last card in the inventory carousel, shaped like the thing it made. That
// worked while the carousel was the only place characters existed. It is now a picker, and adding
// belongs where the rest of managing a character does.
export function AddCharacter({ onAdded }: { onAdded: (character: Character) => void }) {
  const { getToken } = useAuth();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    const trimmed = name.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError(null);
    try {
      const character = await apiFetch<Character>(
        "/api/characters",
        { method: "POST", body: JSON.stringify({ name: trimmed }) },
        getToken,
      );
      onAdded(character);
      setName("");
    } catch {
      setError("Couldn't add that character. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <form
        className="add-character"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <input
          type="text"
          className="split-input"
          value={name}
          placeholder="in-game name"
          aria-label="In-game name"
          disabled={submitting}
          onChange={(e) => setName(e.target.value)}
        />
        <button type="submit" className="party-save" disabled={submitting || !name.trim()}>
          {submitting ? "Adding..." : "Add character"}
        </button>
      </form>
      {error && <p className="routine-error">{error}</p>}
    </>
  );
}
