"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { InventoryPanel, type InventoryItem } from "@/components/inventory-panel";
import { CharactersSkeleton } from "@/components/loading-skeleton";
import { apiFetch } from "@/lib/api";
import { reportVital } from "@/lib/rum";
import { invalidate, peek, put } from "@/lib/cache";
import { redemptionNote } from "@/lib/redemption";
import type { Character } from "@/types/character";
import type { CharacterToken } from "@/types/character-token";
import { CaptureDock } from "@/components/capture-dock";
import { SearchBar, SearchResults, search } from "@/components/item-search";
import { CharacterCarousel, type Selection } from "@/components/character-carousel";

type LoadState = "loading" | "loaded" | "error";

// The three arrow-navigable regions of the page, top to bottom. Up and down move between them,
// left and right mean something different inside each: characters in the strip, categories in
// the inventory.
type FocusRegion = "search" | "carousel" | "inventory";

const CHARACTERS_KEY = "/api/characters";
const ALL_TOKENS_KEY = "/api/characters/tokens";

export default function CharactersPage() {
  const { getToken } = useAuth();

  // The app-level "initial load" number: how long from arriving on this page to the
  // inventory actually being on screen. Web vitals measure the document (LCP, TTFB);
  // this measures the fetch-to-paint gap that is ours to control. Reported once per
  // visit, whether the page was hard-loaded or navigated to from the landing page.
  const arrivedAt = useRef(0);
  const reportedReady = useRef(false);

  // Stamp the arrival time in an effect, not during render (performance.now() is impure).
  // Declared before the report effect below, so it always runs first on the same commit.
  useEffect(() => {
    arrivedAt.current = performance.now();
  }, []);

  // Seed from cache so a repeat visit paints immediately instead of flashing a
  // loading state while it re-fetches data it already had. The fetch below still
  // runs and overwrites this, the cache decides what you see FIRST, not what is
  // true.
  const seededCharacters = peek<Character[]>(CHARACTERS_KEY);

  const [characters, setCharacters] = useState<Character[]>(seededCharacters ?? []);
  const [state, setState] = useState<LoadState>(seededCharacters ? "loaded" : "loading");

  // null until the roster loads; then the first character. null again only via the eye toggle.
  const [selectedId, setSelectedId] = useState<Selection>(null);

  const [query, setQuery] = useState("");

  // Which region should take focus, and a counter so asking twice for the same one still lands.
  // The page owns this because the three regions are siblings: the carousel cannot reach into the
  // inventory panel, and neither should have to know the other exists.
  //
  // The counter is shared, not one per region. Each region is handed the nonce only while it is
  // the target and 0 otherwise, so its focus effect fires exactly on the turn it is chosen.
  const [focus, setFocus] = useState<{ region: FocusRegion; nonce: number }>({
    region: "search",
    nonce: 0,
  });

  function focusRegion(region: FocusRegion) {
    setFocus((f) => ({ region, nonce: f.nonce + 1 }));
  }

  const signalFor = (region: FocusRegion) => (focus.region === region ? focus.nonce : 0);

  function handleSelectItem(name: string) {
    setQuery(name);
    focusRegion("search");
  }

  // Which character to come back to when you turn the generic upload back off. Without it, the
  // eye is a one-way door: deselecting is easy, and getting back means hunting for the tile you
  // were on.
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  // Tokens are kept PER CHARACTER, not as a single "the tokens" slot.
  //
  // Two reasons, and the second one is what you see. Overlapping requests: clicking down the
  // strip fires several fetches, and keying by id means a slow answer for one character can
  // never be painted under another's name. And the flash: with a single slot, selecting a
  // character blanked the inventory (its tokens were "not for this id yet"), the panel collapsed
  // to nothing, and then snapped back a moment later when the fetch landed. Keeping what we
  // already know for each character means a revisit paints instantly, with no empty frame in
  // between, the fetch still runs and still overwrites, it just no longer decides what you see
  // FIRST.
  const [tokensByChar, setTokensByChar] = useState<Record<string, CharacterToken[]>>(
    peek<Record<string, CharacterToken[]>>(ALL_TOKENS_KEY) ?? {},
  );

  // Bumped after an upload writes counts, to re-pull the inventory it just changed.
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    // Every character's inventory is fetched HERE, on load, alongside the roster, not lazily
    // when you click one. The page already knows you are about to look at one of these; it just
    // does not know which. Waiting to find out puts a network round-trip between the click and
    // the pixels, and that gap is the flicker: the panel renders empty, then fills.
    // One token for the whole burst. getToken() can round-trip to Clerk, and that cost is paid
    // BEFORE each request goes out (see lib/api.ts), so the roster and the bulk tokens loading
    // together would each pay it. Mint once and share.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          apiFetch<Record<string, CharacterToken[]>>(ALL_TOKENS_KEY, { method: "GET" }, withToken),
        ]);
      })
      .then(([characterResult, allTokens]) => {
        // The bulk query only returns characters that HAVE something. A character with an empty
        // inventory comes back absent, which is indistinguishable from "not fetched yet", so it
        // would sit on a loading state forever. Say so explicitly: no tokens is an answer.
        const seeded: Record<string, CharacterToken[]> = { ...allTokens };
        for (const c of characterResult) seeded[c.id] ??= [];

        setCharacters(characterResult);
        setTokensByChar(seeded);
        // Land on a character rather than on nothing. There is no "everyone" view any more, the
        // aggregate was summing items that cannot be moved between characters, which is a number
        // with no meaning, and "who has what" is now a search, not a landing page.
        setSelectedId((current) => current ?? characterResult[0]?.id ?? null);
        put(CHARACTERS_KEY, characterResult);
        put(ALL_TOKENS_KEY, seeded);
        setState("loaded");
      })
      // Only show the error state if we have nothing at all. A failed refresh
      // behind data we already have should not blank the page.
      .catch(() => setState((s) => (s === "loaded" ? "loaded" : "error")));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revision]);

  // The bulk load above already holds the selected character's tokens, and it re-runs on every
  // upload (via `revision`), so it is the single source of freshness. This only fetches when we
  // genuinely hold nothing for the id yet, e.g. a character added mid-session before the next
  // bulk load. Refetching data we already have was a wasted round-trip on first paint (right
  // after the bulk load seeded it) and on every selection.
  useEffect(() => {
    if (selectedId === null) return;
    const id = selectedId;
    if (tokensByChar[id] !== undefined) return;
    let cancelled = false;
    apiFetch<CharacterToken[]>(`/api/characters/${id}/tokens`, { method: "GET" }, getToken)
      .then((tokens) => {
        if (!cancelled) setTokensByChar((prev) => ({ ...prev, [id]: tokens }));
      })
      .catch(() => {
        /* keep showing what we have */
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, revision]);

  // Every write drops the cache. A cache that can serve a stale list after you have
  // added, renamed or deleted a character is worse than no cache at all: the wrong
  // answer arrives instantly and looks exactly like a backend bug.
  function handleAdded(character: Character) {
    setCharacters((prev) => [...prev, character]);
    invalidate("/api/");
  }

  function handleUpdated(character: Character) {
    setCharacters((prev) => prev.map((c) => (c.id === character.id ? character : c)));
    invalidate("/api/");
  }

  function handleDeleted(id: string) {
    setCharacters((prev) => prev.filter((c) => c.id !== id));
    if (selectedId === id) setSelectedId(null);
    invalidate("/api/");
  }

  // Reorder optimistically so the strip moves the instant you click, then persist. The cache is
  // updated to match what is shown; a failed save drops it so the next load re-fetches the truth.
  function handleReorder(ordered: Character[]) {
    setCharacters(ordered);
    put(CHARACTERS_KEY, ordered);
    apiFetch<Character[]>(
      "/api/characters/order",
      { method: "PUT", body: JSON.stringify({ orderedIds: ordered.map((c) => c.id) }) },
      getToken,
    ).catch(() => invalidate("/api/"));
  }

  const selected = characters.find((c) => c.id === selectedId);

  const searching = query.trim().length > 0;
  const matches = search(query, characters, tokensByChar);

  const selectedTokens = selectedId ? tokensByChar[selectedId] : undefined;
  const tokensReady = selectedTokens !== undefined;

  useEffect(() => {
    if (reportedReady.current) return;
    if (state !== "loaded" || !tokensReady) return;
    reportedReady.current = true;
    reportVital({ name: "inventory-ready", value: performance.now() - arrivedAt.current });
  }, [state, tokensReady]);
  const characterItems: InventoryItem[] = (selectedTokens ?? []).map((token) => ({
    id: token.tokenCatalogId,
    name: token.name,
    iconUrl: token.iconUrl,
    quantity: token.quantity,
    itemGroup: token.itemGroup,
    note: token.redeemThreshold
      ? `${redemptionNote(token.quantity, token.redeemThreshold)}\nbuys: ${token.redeemSlots.join(" / ")}`
      : `${token.quantity} in total`,
  }));

  return (
    <main className="page">
      <h1 className="page-title">Inventory</h1>

      {state === "error" && <p>Couldn&apos;t load your characters.</p>}

      {/* One deliberate loading state, not the real chrome assembling itself in stages. The
          skeleton mirrors the finished layout, so when the data lands the real UI crossfades in
          as one piece rather than an empty inventory and a lone "add character" tile filling in. */}
      {state === "loading" && <CharactersSkeleton />}

      {state === "loaded" && (
        <div className="chars-ready">
          <SearchBar
            query={query}
            onQuery={setQuery}
            characters={characters}
            tokensByChar={tokensByChar}
            onSelectCharacter={setSelectedId}
            focusSignal={signalFor("search")}
            onLeaveDown={() => focusRegion("carousel")}
          />

          <CharacterCarousel
            characters={characters}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onUpdated={handleUpdated}
            onDeleted={handleDeleted}
            onAdded={handleAdded}
            onReorder={handleReorder}
            focusSignal={signalFor("carousel")}
            onLeaveUp={() => focusRegion("search")}
            onLeaveDown={() => focusRegion("inventory")}
          />

          {/* The selected character's inventory sits directly under the carousel: pick a
              character, see their stuff. Searching answers a question the inventory cannot, so it
              takes over this same slot while you are asking it. */}
          {searching ? (
            <SearchResults query={query} matches={matches} />
          ) : selected ? (
            <InventoryPanel
              title={selected.name}
              loading={!tokensReady}
              emptyHint="No tokens here yet. Upload an inventory screenshot."
              items={characterItems}
              // Clicking an item searches every character for it: the query fills the bar above
              // (bound to this same state), focus moves there so it can be edited (see SearchBar),
              // and the results take over this slot.
              onSelectItem={handleSelectItem}
              focusSignal={signalFor("inventory")}
              onLeaveUp={() => focusRegion("carousel")}
            />
          ) : characters.length === 0 ? (
            <p className="finder-empty">Add a character above to start tracking.</p>
          ) : (
            <p className="finder-empty">
              No character selected, a screenshot dropped below will be filed by the name read from
              it. Pick a character to see their inventory.
            </p>
          )}

          <CaptureDock
            characters={characters}
            pinnedCharacterId={selectedId}
            stored={new Map((selectedTokens ?? []).map((t) => [t.tokenCatalogId, t.quantity]))}
            getToken={getToken}
            onCharacterAdded={handleAdded}
            onSaved={() => setRevision((n) => n + 1)}
            onToggleGeneric={() => {
              if (selectedId) {
                setLastSelectedId(selectedId);
                setSelectedId(null);
              } else {
                setSelectedId(lastSelectedId ?? characters[0]?.id ?? null);
              }
            }}
          />
        </div>
      )}
    </main>
  );
}
