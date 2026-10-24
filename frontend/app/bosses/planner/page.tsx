"use client";

import { type ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DifficultySelect } from "@/components/difficulty-select";
import { IconSelect, type IconOption } from "@/components/icon-select";
import { PageSwap } from "@/components/page-swap";
import { apiAssetUrl, apiFetch, failureText, spriteUrl } from "@/lib/api";
import { BOSS_ART } from "@/lib/boss-art";
import { bossLabel } from "@/lib/boss-difficulty";
import { BOSS_MAX_PARTY } from "@/lib/boss-hp";
import { peek, put } from "@/lib/cache";
import {
  planParties,
  plannerDifficulties,
  snapStrength,
  SOLO,
  strengthTicks,
  type PlannedParty,
  type Want,
} from "@/lib/party-planner";
import {
  addCharacter,
  type Draft,
  DRAFT_KEY,
  draftKey,
  draftWants,
  EMPTY_DRAFT,
  jobOf,
  type LocalDraft,
  markLynn,
  parseDraft,
  pickDraft,
  readLocal,
  removeCharacter,
  resolveCharacter,
  type RosterGroup,
  type SavedPlanner,
  shownCharacters,
  YOU,
} from "@/lib/planner-draft";
import { MAX_IGN_LENGTH } from "@/lib/ign";
import { preloadBossArt } from "@/lib/preload-boss-art";
import { useCharacterSprites } from "@/lib/ign-sprites";
import { knownSprite, spriteByName } from "@/lib/sprite-by-name";
import { useAuth } from "@/lib/use-auth";
import type { Boss } from "@/types/boss";
import type { Character } from "@/types/character";
import type { Party, Person, SeatedParty } from "@/types/party";

type LoadState = "loading" | "loaded" | "error";

const BOSSES_KEY = "/api/bosses";
const CHARACTERS_KEY = "/api/characters";
const PEOPLE_KEY = "/api/people";
// Read only for the sprites of other people's characters, which the seats already looked up.
const PARTIES_KEY = "/api/parties";
const SEATED_KEY = "/api/parties/seated";
const PLANNER_KEY = "/api/planner";

const NO_BOSS: IconOption = { value: "", label: "Choose...", iconUrl: null };

const percent = (strength: number) => `${Math.round((strength / SOLO) * 100)}%`;

/** The portrait the bundle ships, or the one /api/bosses names, resolved. */
function bossArt(boss: Boss | undefined, bossKey: string): string | null {
  const path = BOSS_ART[bossKey] ?? boss?.iconUrl;
  return path ? apiAssetUrl(path) : null;
}

// An external store rather than useState, for the server snapshot. See lib/remembered-flag.ts.
const draftListeners = new Set<() => void>();
let draftCache: Draft | null = null;

function subscribeDraft(listener: () => void) {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

function storedLocal(): LocalDraft | null {
  try {
    return readLocal(localStorage.getItem(DRAFT_KEY));
  } catch {
    return null;
  }
}

function currentDraft(): Draft {
  if (draftCache === null) draftCache = storedLocal()?.draft ?? EMPTY_DRAFT;
  return draftCache;
}

/** The working copy, kept in this browser. `editedAt` is a save's time when adopting the save. */
function setDraft(next: Draft, editedAt = Date.now()) {
  draftCache = next;
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ draft: next, editedAt }));
  } catch {
    // A private window keeps the draft for this visit only.
  }
  for (const listener of draftListeners) listener();
}

/**
 * Opens on whatever pickDraft says, and returns the account's save as the baseline for Save.
 *
 * Adopting the save is stamped with the save's own time, not now: it is not an edit, so it must not
 * count as newer than the next save made on another device.
 */
function adoptSaved(result: SavedPlanner): Draft | null {
  const baseline = result.draft == null ? null : parseDraft(result.draft);
  const open = pickDraft(storedLocal(), result);
  const fromSave = baseline !== null && draftKey(open) === draftKey(baseline);
  if (fromSave && draftKey(open) !== draftKey(currentDraft())) {
    setDraft(open, result.savedAt ? Date.parse(result.savedAt) : 0);
  }
  return baseline;
}

export default function PartyPlannerPage() {
  preloadBossArt();
  const { getToken, isLoaded } = useAuth();

  const [bosses, setBosses] = useState<Boss[]>(peek<Boss[]>(BOSSES_KEY) ?? []);
  const [characters, setCharacters] = useState<Character[]>(
    peek<Character[]>(CHARACTERS_KEY) ?? [],
  );
  const [people, setPeople] = useState<Person[]>(peek<Person[]>(PEOPLE_KEY) ?? []);
  const [parties, setParties] = useState<Party[]>(peek<Party[]>(PARTIES_KEY) ?? []);
  const [seated, setSeated] = useState<SeatedParty[]>(peek<SeatedParty[]>(SEATED_KEY) ?? []);
  const [state, setState] = useState<LoadState>("loading");
  const draft = useSyncExternalStore(subscribeDraft, currentDraft, () => EMPTY_DRAFT);
  // What the account last saved, or null before it answers or if it never has.
  const [saved, setSaved] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Boss[]>(BOSSES_KEY, { method: "GET" }, withToken),
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          apiFetch<Person[]>(PEOPLE_KEY, { method: "GET" }, withToken),
          apiFetch<Party[]>(PARTIES_KEY, { method: "GET" }, withToken),
          apiFetch<SeatedParty[]>(SEATED_KEY, { method: "GET" }, withToken),
          apiFetch<SavedPlanner>(PLANNER_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(
        ([bossResult, characterResult, peopleResult, partyResult, seatedResult, savedResult]) => {
          setSaved(adoptSaved(savedResult));
          setBosses(bossResult);
          setCharacters(characterResult);
          setPeople(peopleResult);
          setParties(partyResult);
          setSeated(seatedResult);
          put(BOSSES_KEY, bossResult);
          put(CHARACTERS_KEY, characterResult);
          put(PEOPLE_KEY, peopleResult);
          put(PARTIES_KEY, partyResult);
          put(SEATED_KEY, seatedResult);
          setState("loaded");
        },
      )
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded]);

  const changed = draftKey(draft) !== draftKey(saved ?? EMPTY_DRAFT);

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      const result = await apiFetch<SavedPlanner>(
        PLANNER_KEY,
        { method: "PUT", body: JSON.stringify({ draft }) },
        getToken,
      );
      setSaved(result.draft == null ? null : parseDraft(result.draft));
      setDraft(draft, result.savedAt ? Date.parse(result.savedAt) : Date.now());
    } catch (e) {
      setSaveError(failureText(e, "Couldn't save. Try again."));
    } finally {
      setSaving(false);
    }
  }

  const bossByKey = new Map(bosses.map((b) => [b.bossKey, b]));
  const bossOptions: IconOption[] = bosses
    .filter((b) => plannerDifficulties(b.bossKey, b.difficulties).length > 0)
    .map((b) => ({ value: b.bossKey, label: b.name, iconUrl: bossArt(b, b.bossKey) }));

  const sprites = useMemo(
    () => spriteByName(characters, [...parties, ...seated.map((row) => row.party)]),
    [characters, parties, seated],
  );

  const roster = useMemo(() => {
    const groups: RosterGroup[] = [
      { personId: YOU, label: "You", names: characters.map((c) => c.name) },
    ];
    for (const p of people) {
      const names = [...new Set([...p.ownedCharacters, ...p.characters])];
      if (names.length > 0) groups.push({ personId: p.id, label: p.name, names });
    }
    return groups;
  }, [characters, people]);
  const personName = (id: string) =>
    id === YOU ? null : (roster.find((g) => g.personId === id)?.label ?? null);
  const shown = useMemo(() => shownCharacters(draft, roster), [draft, roster]);
  const onPage = new Set(shown.map((c) => c.name));
  const [typed, setTyped] = useState("");
  const adding = resolveCharacter(typed, roster, shown);

  const knownJobs = useMemo(() => {
    const jobs = new Map<string, string>();
    for (const c of characters) if (c.jobName) jobs.set(c.name.toLowerCase(), c.jobName);
    for (const p of people) {
      for (const [name, job] of Object.entries(p.ownedJobs ?? {}))
        jobs.set(name.toLowerCase(), job);
    }
    return jobs;
  }, [characters, people]);
  const wants = useMemo(() => draftWants(draft, shown, knownJobs), [draft, shown, knownJobs]);
  // Every card's sprite, a typed IGN's included: looked up when the page has none. See ign-sprites.
  const spriteOf = useCharacterSprites(
    shown.map((c) => c.name),
    knownSprite(sprites, people),
  );
  const plan = useMemo(() => planParties(wants), [wants]);
  const wantById = new Map(wants.map((w) => [w.id, w]));
  // The buff note once, under the first slider on the page.
  const firstShown =
    shown.map((c) => draft.wants.findIndex((w) => w.character === c.name)).find((i) => i >= 0) ??
    -1;

  function add() {
    if (adding === null) return;
    setDraft(addCharacter(draft, roster, adding));
    setTyped("");
  }

  function remove(name: string) {
    setDraft(removeCharacter(draft, roster, name));
  }

  function addWant(character: string) {
    setDraft({
      ...draft,
      wants: [
        ...draft.wants,
        { character, bossKey: "", difficulty: "", strength: 0, maxParty: null },
      ],
    });
  }

  function updateWant(index: number, change: Partial<Draft["wants"][number]>) {
    setDraft({
      ...draft,
      wants: draft.wants.map((w, i) => (i === index ? { ...w, ...change } : w)),
    });
  }

  function removeWant(index: number) {
    setDraft({ ...draft, wants: draft.wants.filter((_, i) => i !== index) });
  }

  return (
    <main className="page">
      <div className="page-head">
        <h1 className="page-title">Party Planner</h1>
        {state === "loaded" && (
          <span className="page-head-links">
            <button
              type="button"
              className="party-save"
              disabled={!changed || saving}
              onClick={() => void save()}
            >
              {saving ? "Saving..." : changed ? "Save" : "Saved"}
            </button>
          </span>
        )}
      </div>
      {saveError && <p className="routine-error">{saveError}</p>}
      {state === "error" && (
        <p className="routine-error">Couldn&apos;t load your characters. Reload to try again.</p>
      )}

      <PageSwap
        waiting={state === "loading"}
        placeholder={<p className="party-hint">Loading...</p>}
      >
        <div className="planner">
          <section className="planner-characters">
            {shown.map((c) => {
              const sprite = spriteOf(c.name);
              const owner = personName(c.personId);
              return (
                <div key={c.name} className="party-card planner-character">
                  <div className="planner-character-head">
                    {sprite ? (
                      <img className="seat-sprite" src={spriteUrl(sprite)} alt="" />
                    ) : (
                      <span className="seat-sprite is-empty" aria-hidden="true" />
                    )}
                    <div className="planner-character-name">
                      <h2 className="party-card-name">{c.name}</h2>
                      {(owner || knownJobs.has(c.name.toLowerCase())) && (
                        <span className="party-card-size">
                          {[owner, knownJobs.get(c.name.toLowerCase())].filter(Boolean).join(" · ")}
                        </span>
                      )}
                      {!knownJobs.has(c.name.toLowerCase()) && (
                        <button
                          type="button"
                          className={`run-chip planner-lynn${jobOf(c.name, knownJobs, draft) === "Lynn" ? " is-on" : ""}`}
                          aria-pressed={jobOf(c.name, knownJobs, draft) === "Lynn"}
                          onClick={() =>
                            setDraft(
                              markLynn(draft, c.name, jobOf(c.name, knownJobs, draft) !== "Lynn"),
                            )
                          }
                        >
                          Lynn
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      className="planner-remove"
                      aria-label={`Remove ${c.name}`}
                      onClick={() => remove(c.name)}
                    >
                      ×
                    </button>
                  </div>
                  {draft.wants.map((w, i) => {
                    if (w.character !== c.name) return null;
                    const boss = bossByKey.get(w.bossKey);
                    const cap = BOSS_MAX_PARTY[w.bossKey] ?? 6;
                    const taken = new Set(
                      draft.wants
                        .filter((o, j) => j !== i && o.character === c.name)
                        .map((o) => o.bossKey),
                    );
                    return (
                      <div key={i} className="planner-want">
                        <div className="planner-want-picks">
                          <div className="split-field planner-boss">
                            <span>Boss</span>
                            <IconSelect
                              bosses
                              options={bossOptions.filter((o) => !taken.has(o.value))}
                              placeholder={NO_BOSS}
                              value={w.bossKey}
                              label={`Boss for ${c.name}`}
                              onChange={(bossKey) => {
                                const modes = plannerDifficulties(
                                  bossKey,
                                  bossByKey.get(bossKey)?.difficulties ?? [],
                                );
                                updateWant(i, {
                                  bossKey,
                                  difficulty: modes.length === 1 ? (modes[0] ?? "") : "",
                                  maxParty: null,
                                });
                              }}
                            />
                          </div>
                          <label className="split-field">
                            <span>Difficulty</span>
                            <DifficultySelect
                              difficulties={
                                boss ? plannerDifficulties(boss.bossKey, boss.difficulties) : []
                              }
                              value={w.difficulty}
                              label={`Difficulty for ${c.name}`}
                              onChange={(difficulty) => updateWant(i, { difficulty })}
                            />
                          </label>
                          <label className="split-field">
                            <span>Party Size</span>
                            <select
                              className="split-input"
                              aria-label={`Party size for ${c.name}`}
                              value={w.maxParty ?? ""}
                              disabled={!boss}
                              onChange={(e) =>
                                updateWant(i, {
                                  maxParty: e.target.value === "" ? null : Number(e.target.value),
                                })
                              }
                            >
                              <option value="">Any Size</option>
                              <option value={1}>Solo</option>
                              {Array.from({ length: cap - 1 }, (_, k) => k + 2).map((n) => (
                                <option key={n} value={n}>
                                  Up to {n}
                                </option>
                              ))}
                            </select>
                          </label>
                          <button
                            type="button"
                            className="planner-remove"
                            aria-label={`Remove ${boss?.name ?? "boss"} for ${c.name}`}
                            onClick={() => removeWant(i)}
                          >
                            ×
                          </button>
                        </div>
                        <label className="split-field planner-strength">
                          <span>
                            Strength{" "}
                            <strong className="planner-value">{percent(w.strength)}</strong>
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={SOLO}
                            step={1}
                            list={`ticks-${cap}`}
                            value={w.strength}
                            disabled={!boss}
                            onChange={(e) =>
                              updateWant(i, {
                                strength: snapStrength(Number(e.target.value), cap),
                              })
                            }
                          />
                          <span className="planner-ends">
                            <span>No Damage</span>
                            <span>Solo</span>
                          </span>
                          {i === firstShown && (
                            <small className="planner-sub">
                              Count any damage buffs it gives the party.
                            </small>
                          )}
                        </label>
                      </div>
                    );
                  })}
                  <button
                    type="button"
                    className="party-cancel planner-add"
                    onClick={() => addWant(c.name)}
                  >
                    Add Boss
                  </button>
                </div>
              );
            })}

            <form
              className="planner-add-character"
              onSubmit={(e) => {
                e.preventDefault();
                add();
              }}
            >
              <label className="split-field">
                <span>Add Character</span>
                <input
                  className="split-input"
                  list="planner-known"
                  placeholder="IGN"
                  maxLength={MAX_IGN_LENGTH}
                  autoComplete="off"
                  spellCheck={false}
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </label>
              <button type="submit" className="party-save" disabled={adding === null}>
                Add
              </button>
              <datalist id="planner-known">
                {roster.flatMap((g) =>
                  g.names
                    .filter((name) => !onPage.has(name))
                    .map((name) => (
                      <option key={`${g.personId}\n${name}`} value={name}>
                        {g.label}
                      </option>
                    )),
                )}
              </datalist>
            </form>
          </section>

          {[3, 6].map((n) => (
            <datalist key={n} id={`ticks-${n}`}>
              {[0, ...strengthTicks(n), SOLO].map((t) => (
                <option key={t} value={t} />
              ))}
            </datalist>
          ))}

          {(plan.parties.length > 0 || plan.unplaced.length > 0) && (
            <section className="planner-plan">
              <h2 className="planner-heading">Parties</h2>
              {!plan.exact && <p className="party-hint">Large groups are approximate.</p>}
              {plan.parties.map((p) => (
                <PlannedCard
                  key={p.seats.map((s) => s.wantId).join("|")}
                  party={p}
                  boss={bossByKey.get(p.bossKey)}
                  sprite={(name) => spriteOf(name) ?? undefined}
                  personName={personName}
                />
              ))}
              {plan.unplaced.length > 0 && (
                <div className="party-card">
                  <h3 className="party-card-name">No Party</h3>
                  <ul className="roster-strip">
                    {plan.unplaced.map((u) => {
                      const want = wantById.get(u.wantId);
                      if (!want) return null;
                      const art = bossArt(bossByKey.get(want.bossKey), want.bossKey);
                      return (
                        <SeatTile
                          key={u.wantId}
                          want={want}
                          sprite={spriteOf(want.character) ?? undefined}
                          owner={personName(want.personId)}
                        >
                          <span className="planner-tile-boss">
                            {art && <img className="boss-portrait is-small" src={art} alt="" />}
                            {bossLabel(
                              bossByKey.get(want.bossKey)?.name ?? want.bossKey,
                              want.difficulty,
                            )}
                          </span>
                          <span className="planner-tile-note">
                            {u.reason === "alone" ? "Can't clear in time" : "No room"}
                          </span>
                        </SeatTile>
                      );
                    })}
                  </ul>
                </div>
              )}
            </section>
          )}
        </div>
      </PageSwap>
    </main>
  );
}

/** One character as Party View draws a seat: the whole sprite, then its name and owner. */
function SeatTile({
  want,
  sprite,
  owner,
  children,
}: {
  want: Pick<Want, "character" | "personId">;
  sprite: string | undefined;
  owner: string | null;
  children?: ReactNode;
}) {
  return (
    <li className={`roster-tile${want.personId === YOU ? " is-mine" : ""}`}>
      {sprite ? (
        <img className="roster-sprite" src={spriteUrl(sprite)} alt="" />
      ) : (
        <span className="roster-sprite is-empty" aria-hidden="true" />
      )}
      <span className="roster-name">{want.character}</span>
      {owner && <span className="roster-person">{owner}</span>}
      {children}
    </li>
  );
}

function PlannedCard({
  party,
  boss,
  sprite,
  personName,
}: {
  party: PlannedParty;
  boss: Boss | undefined;
  sprite: (name: string) => string | undefined;
  personName: (id: string) => string | null;
}) {
  const total = party.seats.reduce((sum, s) => sum + s.shares, 0);
  const art = bossArt(boss, party.bossKey);
  return (
    <div className="party-card">
      <div className="planner-character-head">
        {art && <img className="boss-portrait" src={art} alt="" />}
        <h3 className="party-card-name">
          {bossLabel(boss?.name ?? party.bossKey, party.difficulty)}
        </h3>
        <span className="party-card-size">~{party.minutes} min</span>
      </div>
      <ul className="roster-strip">
        {party.seats.map((s) => (
          <SeatTile
            key={s.wantId}
            want={s}
            sprite={sprite(s.character)}
            owner={personName(s.personId)}
          >
            <span className="planner-share">
              {party.seats.length === 1 ? "Solo" : `${Math.round((s.shares / total) * 100)}%`}
            </span>
          </SeatTile>
        ))}
      </ul>
    </div>
  );
}
