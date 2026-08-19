"use client";

import { PageSwap } from "@/components/page-swap";
import { useAuth } from "@/lib/use-auth";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ApiError, apiFetch } from "@/lib/api";
import { peek, put } from "@/lib/cache";
import type { Person, SavePeopleBody } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";
type Draft = { id?: string; name: string; characters: string };

const PEOPLE_KEY = "/api/people";

// Who plays which character. Kept apart from the parties on purpose: a party names characters, and
// this says whose they are, once, for every party that names them. Say it here and CreedBratton is
// Chris's everywhere he turns up.
export default function PeoplePage() {
  const { getToken } = useAuth();

  const [people, setPeople] = useState<Person[]>(peek<Person[]>(PEOPLE_KEY) ?? []);
  const [draft, setDraft] = useState<Draft[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Characters are edited as one comma-separated line per person, because that is how they are
  // read out loud ("Jared plays Premial, Lynn and Corsair") and a row of inputs per character is a
  // lot of furniture for a list you touch twice a year.
  const toDraft = (rows: Person[]): Draft[] =>
    rows.map((p) => ({ id: p.id, name: p.name, characters: p.characters.join(", ") }));

  useEffect(() => {
    getToken()
      .then((token) =>
        apiFetch<Person[]>(PEOPLE_KEY, { method: "GET" }, () => Promise.resolve(token)),
      )
      .then((result) => {
        setPeople(result);
        setDraft(toDraft(result));
        put(PEOPLE_KEY, result);
        setState("loaded");
      })
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function save() {
    const body: SavePeopleBody = {
      people: draft
        .filter((row) => row.name.trim() !== "")
        .map((row) => ({
          ...(row.id ? { id: row.id } : {}),
          name: row.name.trim(),
          characters: row.characters
            .split(",")
            .map((c) => c.trim())
            .filter((c) => c !== ""),
        })),
    };
    setBusy(true);
    setError(null);
    try {
      const saved = await apiFetch<Person[]>(
        PEOPLE_KEY,
        { method: "PUT", body: JSON.stringify(body) },
        getToken,
      );
      setPeople(saved);
      setDraft(toDraft(saved));
      put(PEOPLE_KEY, saved);
    } catch (e) {
      // The backend refuses with the reason (see validatePeople): two people sharing a name, or
      // both claiming the same character. Both are worth reading rather than "went wrong".
      setError(e instanceof ApiError ? e.body : "Couldn't save that.");
    } finally {
      setBusy(false);
    }
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(people));

  return (
    <main className="page">
      <p className="loot-back">
        <Link href="/bosses/parties/edit">&larr; Edit parties</Link>
      </p>
      <h1 className="page-title">People</h1>

      {state === "error" && <p>Couldn&apos;t load your people.</p>}
      <PageSwap
        waiting={state === "loading"}
        placeholder={<p className="party-hint">Loading...</p>}
      >
        {state === "loaded" && (
          <>
            <div className="people-list">
              {draft.map((row, index) => (
                // A saved person keys on their id; a new row has only its slot.
                <div className="person-row" key={row.id ?? `new-${index}`}>
                  <input
                    className="split-input person-name"
                    value={row.name}
                    onChange={(e) =>
                      setDraft(
                        draft.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)),
                      )
                    }
                    placeholder="Jared"
                    aria-label="Person's name"
                    maxLength={40}
                  />
                  <input
                    className="split-input person-characters"
                    value={row.characters}
                    onChange={(e) =>
                      setDraft(
                        draft.map((r, i) =>
                          i === index ? { ...r, characters: e.target.value } : r,
                        ),
                      )
                    }
                    placeholder="Premial, Lynn, Corsair"
                    aria-label={`Characters ${row.name || "this person"} plays`}
                  />
                  <button
                    type="button"
                    className="party-delete"
                    disabled={busy}
                    onClick={() => setDraft(draft.filter((_, i) => i !== index))}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>

            <div className="loot-actions">
              <button
                type="button"
                className="party-add-seat"
                onClick={() => setDraft([...draft, { name: "", characters: "" }])}
              >
                + Person
              </button>
              <button type="button" className="party-save" disabled={busy || !dirty} onClick={save}>
                {busy ? "Saving..." : "Save people"}
              </button>
              {error && <span className="split-error">{error}</span>}
            </div>

            <p className="party-hint">
              Removing somebody leaves every party exactly as it is. It only takes back who their
              characters belong to.
            </p>
          </>
        )}
      </PageSwap>
    </main>
  );
}
