"use client";

import { PageSwap } from "@/components/page-swap";
import { useAuth } from "@/lib/use-auth";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { InventoryPanel, type InventoryItem } from "@/components/inventory-panel";
import { CharactersSkeleton } from "@/components/loading-skeleton";
import { apiFetch } from "@/lib/api";
import { reportVital } from "@/lib/rum";
import { invalidate, peek, put } from "@/lib/cache";
import { STARTING_COUNT, addableItems } from "@/lib/add-item";
import {
  noPending,
  pendingFor,
  shownCount,
  withPending,
  withoutPending,
} from "@/lib/pending-counts";
import { redemptionNote } from "@/lib/redemption";
import type { TokenCatalogItem } from "@/types/token-catalog";
import type { Character } from "@/types/character";
import type { CharacterToken } from "@/types/character-token";
import { SearchBar, SearchResults, search } from "@/components/item-search";
import { CharacterCarousel, type Selection } from "@/components/character-carousel";

type LoadState = "loading" | "loaded" | "error";

const CHARACTERS_KEY = "/api/characters";
const ALL_TOKENS_KEY = "/api/characters/tokens";
// Every item that EXISTS, which is not the list of items HELD. An item held none of has no
// slot to hover, so the + at the end of the grid is the only way in for it.
const CATALOG_KEY = "/api/tokens/catalog";

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

  // Bumped after a write, to re-pull the inventory it just changed.
  const [revision, setRevision] = useState(0);

  // Optional: losing it costs the + and nothing else, so it does not hold the inventory up.
  const [catalog, setCatalog] = useState<TokenCatalogItem[]>(
    peek<TokenCatalogItem[]>(CATALOG_KEY) ?? [],
  );

  useEffect(() => {
    // Every character's inventory is fetched HERE, on load, alongside the roster, not lazily
    // when you click one. The page already knows you are about to look at one of these; it just
    // does not know which. Waiting to find out puts a network round-trip between the click and
    // the pixels, and that gap is the flicker: the panel renders empty, then fills.
    // One token for the whole burst. getToken() can round-trip to auth, and that cost is paid
    // BEFORE each request goes out (see lib/api.ts), so the roster and the bulk tokens loading
    // together would each pay it. Mint once and share.
    getToken()
      .then((token) => {
        const withToken = () => Promise.resolve(token);
        return Promise.all([
          apiFetch<Character[]>(CHARACTERS_KEY, { method: "GET" }, withToken),
          apiFetch<Record<string, CharacterToken[]>>(ALL_TOKENS_KEY, { method: "GET" }, withToken),
          apiFetch<TokenCatalogItem[]>(CATALOG_KEY, { method: "GET" }, withToken).catch(() => null),
        ]);
      })
      .then(([characterResult, allTokens, catalogResult]) => {
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
        if (catalogResult) {
          setCatalog(catalogResult);
          put(CATALOG_KEY, catalogResult);
        }
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

  /**
   * A count being stepped, before it is written. Keyed by item, and only ever for the character on
   * screen, so a figure cannot be painted under somebody else's name.
   *
   * The stepper fires far faster than a save should, so what it changes is THIS rather than the
   * server: the total lands once the pressing stops. See SAVE_AFTER_MS.
   */
  //
  // Carried with the CHARACTER it belongs to and nothing else, so it outlives the re-pull the write
  // triggers. It used to be keyed on the refresh counter too, and that was the flicker: the figure
  // was dropped the moment the write succeeded, which is a round trip before the answer carrying it
  // arrives, so the slot fell back to the stored number and showed the old count in between. See
  // lib/pending-counts.ts.
  const [pending, setPending] = useState(() => noPending(selectedId ?? ""));
  const stepped = pendingFor(pending, selectedId ?? "");

  /** Writes one item's total, and re-pulls so what is on screen is the server's answer. */
  async function commitCount(tokenCatalogId: string, quantity: number) {
    if (!selectedId) return;
    try {
      await apiFetch<unknown>(
        `/api/characters/${selectedId}/tokens/${tokenCatalogId}`,
        { method: "PUT", body: JSON.stringify({ quantity }) },
        getToken,
      );
      // The figure the server now holds, so what is on screen agrees with it through the re-pull
      // and after it. Without this a stale one outlives its write: stepping an item to zero
      // deletes the row, and re-adding it with the + would then draw the 0 over the new 1.
      setPending((current) => withPending(current, selectedId, tokenCatalogId, quantity));
      invalidate(ALL_TOKENS_KEY);
      setRevision((n) => n + 1);
    } catch {
      // The figure on screen is now a claim the server has not accepted, so it goes rather than
      // sitting there looking saved. The re-pull puts the stored one back.
      setPending((current) => withoutPending(current, tokenCatalogId));
    }
  }

  const selected = characters.find((c) => c.id === selectedId);

  const searching = query.trim().length > 0;
  const matches = search(query, characters, tokensByChar);

  const selectedTokens = selectedId ? tokensByChar[selectedId] : undefined;
  const tokensReady = selectedTokens !== undefined;

  /** What this character holds none of, for the + at the end of the grid. */
  const addable = addableItems(catalog, selectedTokens ?? []);

  /**
   * Starts holding an item, at one.
   *
   * The same write the stepper commits, so there is one way a count reaches the server. It lands
   * as a slot in the grid on the re-pull, and the stepper takes it from there.
   */
  function addItem(tokenCatalogId: string) {
    void commitCount(tokenCatalogId, STARTING_COUNT);
  }

  const characterItems: InventoryItem[] = (selectedTokens ?? []).map((token) => {
    // What the stepper has moved it to, if anything, else what is stored. Everything below reads
    // this one figure, so the note and the redemption progress cannot disagree with the count
    // drawn under the icon.
    const quantity = shownCount(token.quantity, stepped[token.tokenCatalogId]);
    return {
      id: token.tokenCatalogId,
      name: token.name,
      iconUrl: token.iconUrl,
      quantity,
      itemGroup: token.itemGroup,
      note: token.redeemThreshold
        ? `${redemptionNote(quantity, token.redeemThreshold)}\nbuys: ${token.redeemSlots.join(" / ")}`
        : `${quantity} in total`,
    };
  });

  return (
    <main className="page">
      <h1 className="page-title">Inventory</h1>

      {/* Outside the load states on purpose. The dock is the first thing on the page now, so
          rendering it only once the roster lands would push the whole page down at the moment the
          fetch returns. It also means a screenshot can be dropped while the roster is still on its
          way, which is the same generic upload the eye offers. */}
      {state === "error" && <p>Couldn&apos;t load your characters.</p>}

      {/* One deliberate loading state, not the real chrome assembling itself in stages. The
          skeleton mirrors the finished layout, so when the data lands the real UI crossfades in
          as one piece rather than an empty inventory and a lone "add character" tile filling in.
          It is a true crossfade: the skeleton is held through the fade rather than dropped at the
          moment it ends. See components/page-swap.tsx. */}
      <PageSwap waiting={state === "loading"} placeholder={<CharactersSkeleton />} shaped>
        {state === "loaded" && (
          <>
            <SearchBar
              query={query}
              onQuery={setQuery}
              characters={characters}
              tokensByChar={tokensByChar}
              onSelectCharacter={setSelectedId}
            />

            <CharacterCarousel
              characters={characters}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />

            {/* The selected character's inventory sits directly under the carousel: pick a
              character, see their stuff. Searching answers a question the inventory cannot, so it
              takes over this same slot while you are asking it. */}
            {searching ? (
              <SearchResults query={query} matches={matches} />
            ) : selected ? (
              <InventoryPanel
                // Keyed on the character, so picking a different one tears the panel down and any
                // open count popup with it. The popup takes its write target once, at mount, and
                // one left open across a switch would be bound to the character it opened over.
                key={selected.id}
                title={selected.name}
                loading={!tokensReady}
                emptyHint="No tokens here yet."
                items={characterItems}
                // Hovering an item raises the stepper. onAdjust is every step and writes nothing;
                // onCommit is the total once the pressing stops.
                onAdjust={(id, next) =>
                  setPending((current) => withPending(current, selectedId ?? "", id, next))
                }
                onCommit={commitCount}
                addable={addable}
                onAdd={addItem}
              />
            ) : characters.length === 0 ? (
              // The add control is no longer on this page, so the empty state has to say where it
              // went. Without this the screen is a search bar over nothing.
              <p className="finder-empty">
                No characters yet. <Link href="/characters">Add one</Link> to start tracking.
              </p>
            ) : (
              <p className="finder-empty">
                No character selected, a screenshot dropped above will be filed by the name read
                from it. Pick a character to see their inventory.
              </p>
            )}
          </>
        )}
      </PageSwap>
    </main>
  );
}
