"use client";

import { useEffect, useRef, useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import type { Character } from "@/types/character";
import { redeemableBySet, redemptionNote } from "@/lib/redemption";
import type { CharacterToken } from "@/types/character-token";

// "Who has Kalos pieces, and how many?"
//
// This is the question the aggregate view was pretending to answer and could not. Summing an
// UNTRADEABLE item across characters produces a number nobody can act on: 40 Kalos pieces spread
// four-a-piece over ten characters is not 40 pieces, it is ten characters who each need six more.
// The total is arithmetic that means nothing. WHERE the items are is the whole question.
//
// It costs no network. Every character's inventory is already in the browser, the page fetches
// them all up front so that selecting a character does not flicker, so this filters what is
// already there, on every keystroke. There is nothing to debounce and nothing to wait for.

export type Match = {
  character: Character;
  items: CharacterToken[];
  total: number;
};

// You search for an item by any name you might actually say out loud.
//
// Nobody thinks "Ferocious Beast Entanglement Ring". They think "the thing Kaling drops", or
// "whatever makes an Eternal hat". So a token is matched on everything the catalog knows about it:
// its name, its BOSS, its section, and the PIECES IT BUYS.
//
// Terms are matched independently and all must hit, which is what makes "eternal hat" work: it is
// not a phrase to be found anywhere, it is two facts. Section "Eternal Pieces", slot "Hat",
// and the four tokens that satisfy both are exactly Kalos, Kaling, First Adversary and Malefic
// Star. Matching the query as one string would find nothing.
//
// Fuzzy, and only just: substring first, subsequence as the forgiving fallback, so "kalng" still
// finds Kaling. Deliberately NOT an edit-distance ranker, the catalog is 26 items, and a scorer
// clever enough to be interesting is clever enough to surprise you with a confident wrong answer.
function subsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) {
    if (ch === needle[i]) i++;
    if (i === needle.length) return true;
  }
  return i === needle.length;
}

// A short subsequence matches almost anything: "shoe" is a subsequence of "Shoulder", and "hat" of
// half the catalog. So the fuzzy fallback only applies to terms long enough to be a mistyped word.
const FUZZY_MIN = 5;

// A typo happens INSIDE a word, so the fuzzy fallback is applied per word and never across a
// field. Run across the whole field and the gaps between words become free letters: "eternal
// pieces" contains t-r-a-c-e in order, so searching "trace" for Trace of Eternal Loyalty returned
// all six Eternal pieces; "Kalos the Guardian" contains s-h-a-r-d, so "shard" returned Kalos as
// well as Blissful Fantasy Shard. Measured over the real 26-item catalog, eight words lifted from
// one item's own name matched a different item this way. Per word, none do.
//
// The substring test above still runs on the WHOLE field, so multi-word queries ("shangri-la",
// "chu chu") keep working.
function fuzzyMatchesField(term: string, field: string): boolean {
  return field.split(/[^a-z0-9]+/).some((word) => subsequence(term, word));
}

// The game does not call a slot by one name. A hat is a Bandana on a thief; a top is a Hood, a
// Shirt, a Coat, a Robe or an Armor depending on the class. Someone hunting for what makes their
// robe types "robe", and the catalog's canonical "Top" will not find it.
//
// SEARCH aliases only. The catalog keeps ONE canonical name per slot, because redemption is counted
// against it. Giving a slot several identities in the data would let a piece-set silently split
// in two, which is the exact class of bug lib/redemption.ts exists to prevent.
const SLOT_ALIASES: Record<string, string[]> = {
  hat: ["cap", "bandana", "helm", "helmet", "hood", "circlet"],
  top: ["shirt", "coat", "robe", "armor", "armour", "overall"],
  bottom: ["pants", "trousers", "shorts", "skirt"],
  // No "accessory" here. It is not what the game calls this slot, and as an alias for Shoulder it
  // answered "accessory" with Hat/Top/Bottom/Shoulder, which is the opposite of the Cape/Glove/Shoe
  // set people mean by the word. A wrong answer, delivered confidently. Nothing is a better answer.
  shoulder: ["pauldron"],
  cape: ["cloak"],
  glove: ["gloves", "gauntlet"],
  shoe: ["shoes", "boots", "boot"],
};

// `owner` is the name of the character holding the token, and it is matched as just another field.
// That falls out of terms being independent facts rather than a phrase: "lumi" narrows to who is
// holding it, "lumi kalos" narrows to both, and neither needs a syntax to say which is which.
//
// Without it, typing a character's own name answered "No character is holding anything matching
// Lumi", which is true of the items and useless to the person: the character is right there on the
// strip above.
export function matchesQuery(token: CharacterToken, terms: string[], owner = ""): boolean {
  const slots = token.redeemSlots.flatMap((s) => [s, ...(SLOT_ALIASES[s.toLowerCase()] ?? [])]);
  const fields = [token.name, token.sourceBoss ?? "", token.itemGroup ?? "", owner, ...slots]
    .filter(Boolean)
    .map((f) => f.toLowerCase());
  return terms.every((t) =>
    fields.some((f) => f.includes(t) || (t.length >= FUZZY_MIN && fuzzyMatchesField(t, f))),
  );
}

export function queryTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

export function search(
  query: string,
  characters: Character[],
  tokensByChar: Record<string, CharacterToken[]>,
): Match[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];

  return (
    characters
      .map((character) => {
        const items = (tokensByChar[character.id] ?? []).filter((t) =>
          matchesQuery(t, terms, character.name),
        );
        return { character, items, total: items.reduce((n, t) => n + t.quantity, 0) };
      })
      .filter((m) => m.items.length > 0)
      // Most of it first: the character you are looking for is almost always the one with the most.
      .sort((a, b) => b.total - a.total)
  );
}

// What the dropdown offers while you type. A character, or an item you actually hold.
export type Suggestion =
  | { kind: "character"; key: string; id: string; label: string; sub: string }
  | { kind: "item"; key: string; label: string; sub: string; iconUrl: string | null };

const MAX_SUGGESTIONS = 8;

// How well the whole label matches, as opposed to whether it matches at all.
//
// This is a RANK, not a score: four ordered buckets, and ties are broken by the shorter label. It
// is deliberately not an edit-distance scorer, for the same reason the matcher is not one (see the
// note above `subsequence`): at 26 items, a ranker clever enough to be interesting is clever enough
// to put a confident wrong answer at the top, and the top is the row one ArrowDown away.
function rank(label: string, term: string): number {
  const l = label.toLowerCase();
  if (l === term) return 0;
  if (l.startsWith(term)) return 1;
  if (l.includes(term)) return 2;
  return 3; // matched, but only via the fuzzy fallback
}

export function suggest(
  query: string,
  characters: Character[],
  tokensByChar: Record<string, CharacterToken[]>,
): Suggestion[] {
  const terms = queryTerms(query);
  if (terms.length === 0) return [];
  const first = terms[0] ?? "";

  const out: { s: Suggestion; r: number }[] = [];

  for (const c of characters) {
    // Reuse the matcher rather than re-deriving one. A second, subtly different notion of "matches"
    // is how the dropdown ends up offering something the results below then refuse to show.
    const hit = terms.every(
      (t) =>
        c.name.toLowerCase().includes(t) ||
        (t.length >= FUZZY_MIN && fuzzyMatchesField(t, c.name.toLowerCase())),
    );
    if (!hit) continue;
    const held = (tokensByChar[c.id] ?? []).length;
    out.push({
      s: {
        kind: "character",
        key: `c:${c.id}`,
        id: c.id,
        label: c.name,
        sub: held === 1 ? "1 item" : `${held} items`,
      },
      r: rank(c.name, first),
    });
  }

  // One entry per item, not one per holding: the same token on nine mules is one thing to suggest.
  const seen = new Set<string>();
  for (const tokens of Object.values(tokensByChar)) {
    for (const t of tokens) {
      if (seen.has(t.tokenCatalogId)) continue;
      if (!matchesQuery(t, terms)) continue;
      seen.add(t.tokenCatalogId);
      out.push({
        s: {
          kind: "item",
          key: `i:${t.tokenCatalogId}`,
          label: t.name,
          sub: t.sourceBoss ?? t.itemGroup ?? "",
          iconUrl: t.iconUrl,
        },
        r: rank(t.name, first),
      });
    }
  }

  return out
    .sort((a, b) => a.r - b.r || a.s.label.length - b.s.label.length)
    .slice(0, MAX_SUGGESTIONS)
    .map((x) => x.s);
}

// Where an arrow key moves the highlight. The rows are 0..count-1 and the BAR is -1, a real
// position on the ring rather than "unset", so arrowing off either end lands back in the bar
// instead of wrapping last-to-first.
export function nextActive(current: number, count: number, delta: number): number {
  const ring = count + 1;
  return ((current + 1 + delta + ring) % ring) - 1;
}

// Bold the part you typed, so the row says WHY it is here. Only for a real substring: highlighting
// a fuzzy match means scattering bold letters across a word, which reads as a rendering fault.
function Highlight({ text, term }: { text: string; term: string }) {
  const at = term ? text.toLowerCase().indexOf(term) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + term.length)}</mark>
      {text.slice(at + term.length)}
    </>
  );
}

// Deliberately two components, not one with a flag. The BAR belongs at the top of the page, above
// the character strip; the RESULTS belong where the inventory is, because they are what you are
// looking at instead of it. Rendering one component in both places put two search boxes on screen.
export function SearchBar({
  query,
  onQuery,
  characters,
  tokensByChar,
  onSelectCharacter,
  focusSignal = 0,
  onLeaveDown,
}: {
  query: string;
  onQuery: (q: string) => void;
  characters: Character[];
  tokensByChar: Record<string, CharacterToken[]>;
  onSelectCharacter: (id: string) => void;
  // Arrow down out of the bar, into the character strip. Only when there are no suggestions to
  // walk: with the list open, down belongs to the list.
  onLeaveDown?: () => void;
  // Bumped by the page each time an inventory item is clicked into the bar, to pull focus here
  // so the query can be edited straight away. A counter, not a boolean: clicking the same item
  // twice must re-focus, and a boolean would not change.
  focusSignal?: number;
}) {
  const [open, setOpen] = useState(false);
  // -1 is a real position, not "unset": it means the bar itself, with no row taken. Enter there
  // searches for what you typed. Starting at 0 made Enter select the top suggestion instead, so
  // typing a name and pressing Enter jumped to a character you never chose.
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the bar when an item is clicked into it, caret at the end so typing appends and a
  // Backspace trims. Skipped on touch: there, focusing pops the on-screen keyboard up over the
  // results that just replaced the inventory, which is the opposite of helpful. `focusSignal` is
  // 0 on first render (no click yet), so the initial mount never steals focus.
  useEffect(() => {
    if (focusSignal === 0) return;
    if (window.matchMedia?.("(pointer: coarse)").matches) return;
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }, [focusSignal]);

  // Type anywhere on the page and the letter lands in the search bar. The keypress is swallowed and
  // re-applied by hand: focusing during keydown does not reliably redirect the character that
  // triggered it, so the first letter you type would otherwise be dropped.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      // Printable, single character. Space is excluded: it is the scroll/activate key on whatever
      // has focus, and it would open a search for nothing.
      if (e.key.length !== 1 || e.key === " ") return;
      const t = e.target as HTMLElement | null;
      if (
        t &&
        (t.isContentEditable ||
          t.tagName === "INPUT" ||
          t.tagName === "TEXTAREA" ||
          t.tagName === "SELECT")
      ) {
        return;
      }
      const input = inputRef.current;
      if (!input) return;
      e.preventDefault();
      input.focus();
      // Caret to the end before the append lands, or focusing a bar that already has a query can
      // leave it at position 0 and the new letter reads as inserted in the wrong place.
      input.setSelectionRange(input.value.length, input.value.length);
      onQuery(query + e.key);
      setOpen(true);
      setActive(0);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [query, onQuery]);

  const suggestions = suggest(query, characters, tokensByChar);
  const term = queryTerms(query)[0] ?? "";

  // Retyping narrows the list, so an index left pointing past the end falls back to the bar rather
  // than to some row you never arrowed onto.
  const activeIndex = active < suggestions.length ? active : -1;

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function choose(s: Suggestion) {
    setOpen(false);
    if (s.kind === "character") {
      // Naming a character is asking to LOOK at them, not to filter by them. Clear the query so
      // the inventory comes back rather than leaving a search that hides it.
      onQuery("");
      onSelectCharacter(s.id);
    } else {
      onQuery(s.label);
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      // One press clears everything: close the suggestion list AND wipe the query. The query
      // drives the results below, so a single Escape returns you to the inventory in one go.
      setOpen(false);
      if (query) onQuery("");
      return;
    }
    if (!open || suggestions.length === 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        onLeaveDown?.();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(nextActive(activeIndex, suggestions.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(nextActive(activeIndex, suggestions.length, -1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const s = suggestions[activeIndex];
      // Enter with nothing highlighted means "search for what I typed", which the results below
      // already show. Dismiss the suggestions so they stop covering them; typing reopens the list.
      if (s) choose(s);
      else setOpen(false);
    }
  }

  return (
    <section className="finder" ref={boxRef}>
      <div className="finder-bar">
        <input
          ref={inputRef}
          type="search"
          className="finder-input"
          placeholder="Search every character. “kaling”, “eternal hat”, “symbol”, or a character’s name"
          value={query}
          onChange={(e) => {
            onQuery(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          autoComplete="off"
          spellCheck={false}
          aria-label="Find an item across every character"
          role="combobox"
          aria-expanded={open && suggestions.length > 0}
          aria-controls="finder-suggestions"
          aria-activedescendant={
            open && suggestions[activeIndex] ? `sug-${suggestions[activeIndex].key}` : undefined
          }
        />
        {/* Always in the layout, hidden when empty: rendering it only with a query would let the
            input (flex: 1) reclaim the button's slot, so the field visibly narrowed the moment you
            typed. Keeping the slot holds the field one width. */}
        <button
          className={`link finder-clear${query ? "" : " is-empty"}`}
          onClick={() => onQuery("")}
          aria-hidden={!query}
          tabIndex={query ? 0 : -1}
        >
          clear
        </button>
      </div>

      {open && suggestions.length > 0 && (
        <ul className="finder-suggest" id="finder-suggestions" role="listbox">
          {suggestions.map((s, i) => (
            <li
              key={s.key}
              id={`sug-${s.key}`}
              role="option"
              aria-selected={i === activeIndex}
              className={`finder-suggest-row${i === activeIndex ? " active" : ""}`}
              // mousedown, not click: the input's blur would close the list before a click lands.
              onMouseDown={(e) => {
                e.preventDefault();
                choose(s);
              }}
              onMouseEnter={() => setActive(i)}
            >
              {s.kind === "item" && s.iconUrl ? (
                <img src={apiAssetUrl(s.iconUrl)} alt="" aria-hidden="true" />
              ) : (
                <span className="finder-suggest-mark" aria-hidden="true">
                  {s.kind === "character" ? "◆" : "·"}
                </span>
              )}
              <span className="finder-suggest-label">
                <Highlight text={s.label} term={term} />
              </span>
              <span className="finder-suggest-sub">{s.sub}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function SearchResults({ query, matches }: { query: string; matches: Match[] }) {
  const grandTotal = matches.reduce((n, m) => n + m.total, 0);

  // What is ACTUALLY redeemable, counted per character AND per piece-set.
  //
  // The counting lives in lib/redemption.ts, not here, and that is the point: it is the one piece
  // of arithmetic in this app that produces a confident wrong number when it is "simplified", and
  // inline in a component it could not be tested. Every holding is passed through flat and
  // un-summed, redeemableBySet divides each by its own threshold before adding anything, which
  // is what stops pieces being pooled across characters or mixed between tokens.
  const ready = [...redeemableBySet(matches.flatMap((m) => m.items)).entries()];
  return (
    <section className="finder">
      <div className="finder-results">
        {matches.length === 0 ? (
          <p className="finder-empty">
            No character is holding anything matching <strong>{query}</strong>.
          </p>
        ) : (
          <>
            <p className="finder-summary">
              <strong>{grandTotal}</strong> held by{" "}
              <strong>
                {matches.length} {matches.length === 1 ? "character" : "characters"}
              </strong>
              {ready.map(([set, n]) => (
                <span key={set}>
                  {", "}
                  <strong>{n}</strong> {set} redeemable now
                </span>
              ))}
            </p>
            {matches.map(({ character, items, total }) => (
              <article key={character.id} className="finder-row">
                <header>
                  <span className="finder-name">{character.name}</span>
                  {/* Redemption is per character, so the per-character figure is the ACTIONABLE
                      one, the total above only tells you it exists somewhere. Same tested
                      function as the total, so the two can never disagree. */}
                  {[...redeemableBySet(items).entries()].map(([set, n]) => (
                    <span key={set} className="finder-ready">
                      <strong>{n}</strong> {set}
                    </span>
                  ))}
                  <span className="finder-total">{total}</span>
                </header>
                <ul>
                  {items.map((item) => (
                    <li key={item.tokenCatalogId} title={item.name}>
                      {item.iconUrl && (
                        <img src={apiAssetUrl(item.iconUrl)} alt="" aria-hidden="true" />
                      )}
                      {/* The boss, but not the slots. The slots are still SEARCHED on. "robe"
                          finds this. They just do not need restating on every row once the
                          header says what is redeemable. */}
                      <span className="finder-item-name">
                        {item.name}
                        {item.sourceBoss && (
                          <span className="finder-item-boss"> · {item.sourceBoss}</span>
                        )}
                      </span>
                      <span className="finder-item-qty">{item.quantity}</span>
                      {item.redeemThreshold && (
                        <span className="finder-item-note">
                          {redemptionNote(item.quantity, item.redeemThreshold)}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </>
        )}
      </div>
    </section>
  );
}
