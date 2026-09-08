"use client";

import { type CSSProperties, useRef, useState } from "react";

import { BossBands } from "@/components/boss-bands";
import { apiAssetUrl, spriteUrl } from "@/lib/api";
import {
  VISIBLE_COLUMNS,
  bossBands,
  cadenceLabel,
  cellState,
  cellStateLabel,
  clearOfCell,
  clearProgress,
  columnFullyCleared,
  indexClears,
  indexSkips,
  nextClear,
  progressLabel,
  progressMark,
  rowFullyCleared,
  rowNobodyRuns,
} from "@/lib/boss-clears";
import type { Boss, BossClearsByCharacter, BossSkipsByCharacter } from "@/types/boss";
import type { Character } from "@/types/character";

// Bosses on the ROWS, characters on the columns.
//
// The other way round does not fit: 16 bosses against a 794px column leaves ~47px per boss, which
// is not enough for a name and forces rotated headers. Characters are the smaller axis for almost
// everyone, and it is also how the same information is kept by hand today
// (test-fixtures/occluded/boss matrix.png), so the layout matches how it is already read.

export function BossMatrix({
  bosses,
  characters,
  clearsByCharacter,
  skipsByCharacter,
  loading,
  historyWeek,
  onToggle,
  busy,
}: {
  bosses: Boss[];
  characters: Pick<Character, "id" | "name" | "spriteImgUrl">[];
  clearsByCharacter: BossClearsByCharacter;
  /** Bosses each character does not run. On a past week, as the routine stood then; see bossSkipsFor. */
  skipsByCharacter?: BossSkipsByCharacter;
  loading?: boolean;
  // Set when showing a past week rather than the current period. See the cadence filter below.
  historyWeek?: string | null;
  /**
   * Answers a cell by hand, without a planner capture. Omitted for a read-only matrix: a past week
   * is shown, not edited, the same rule Party View's cards follow.
   *
   * Two states, not three, matching the party toggle: a cell that has never been reported ticks to
   * cleared, and a cleared one un-ticks to not-cleared. There is no way back to "not reported" from
   * here, so the mark a click leaves is always an answer rather than a return to silence.
   */
  onToggle?: (characterId: string, bossKey: string, cleared: boolean) => void;
  /** A tick is in flight. Ticks serialise, so the matrix always draws what the server last said. */
  busy?: boolean;
}) {
  // Rows, columns and band figures all come from one place, shared with the totals BossBands
  // draws in the corner of the heads. Two counts of the same clears is the disagreement this
  // avoids.
  const { rows, columns, bands } = bossBands({
    bosses,
    characters,
    clearsByCharacter,
    skipsByCharacter,
    historyWeek,
    loading,
  });

  // The row band alone answers "which boss", but not "which character": the header sits up to 17
  // rows away, so reading a mark still means tracing a column by eye. CSS can do a row on its own
  // and cannot do a column, hence the state.
  const [hoveredColumn, setHoveredColumn] = useState<string | null>(null);

  // The column heads scroll sideways with the marks, being a separate table now. See the split
  // below the return.
  const headRef = useRef<HTMLDivElement>(null);
  const colClass = (characterId: string) => (hoveredColumn === characterId ? " is-col-hover" : "");

  // Indexed per character; see lib/boss-clears.ts for why the four cell states are four.
  const byCharacter = new Map<string, Map<string, boolean>>();
  for (const [characterId, clears] of Object.entries(clearsByCharacter)) {
    byCharacter.set(characterId, indexClears(clears));
  }
  const skipsBy = indexSkips(skipsByCharacter ?? {});

  // How many screens wide the table is: 1 up to four characters, 2 at eight, and so on. The width
  // itself is the stylesheet's, which is the only place that knows how much of the column the boss
  // names take. This is the part it cannot know.
  const roster = Math.max(columns.length, 1);
  const span = roster / Math.min(roster, VISIBLE_COLUMNS);

  // True for every view, past weeks included; the same reasoning as bossBands', and it has to be
  // the same answer. This feeds the per-character figures at the foot of each band, and the band's
  // own total is the sum of them: one of the two refusing a denominator while the other took one
  // would put a column of counts under a total that does not add up to them.
  const routineKnown = true;

  // Nothing left to run, so the character steps back the way a finished row does. Counted over the
  // bosses on the table rather than over `bosses`, so a past week is judged on the weekly band it
  // actually shows. See columnFullyCleared for why silence is not a clear.
  const shownBosses = bands.flatMap((band) => band.inCadence);
  const doneClass = (characterId: string) =>
    !loading &&
    columnFullyCleared(byCharacter.get(characterId), shownBosses, skipsBy.get(characterId))
      ? " is-col-cleared"
      : "";

  const statesOf = (characterId: string, list: Boss[]) =>
    list.map((boss) =>
      cellState(byCharacter.get(characterId), boss.bossKey, skipsBy.get(characterId)),
    );

  // Both tables lay their columns out from these rather than from their first row, which is what
  // keeps the split head over the marks it heads. A fixed layout reads its widths off the first
  // row, and the body's first row is a band header spanning every column: measured, that put the
  // names at 152px under a 214px head.
  const columnWidths = (
    <colgroup>
      <col className="boss-name-col" />
      {columns.map((character) => (
        <col key={character.id} />
      ))}
    </colgroup>
  );

  return (
    <div
      className="boss-matrix-wrap"
      style={{ "--boss-span": span, "--boss-cols": roster } as CSSProperties}
      role="status"
      aria-label={loading ? "Loading boss clears" : undefined}
      // Cleared here rather than per cell: leaving one cell for its neighbour would blank the band
      // between the two events.
      onMouseLeave={() => setHoveredColumn(null)}
    >
      {/* The column heads are a table of their own so that they can be held at the top of the
          window: a sticky element sticks to the nearest scrolling box, and the marks have to sit in
          one of those to scroll sideways past four characters. Split, only the marks are inside it.

          The two tables agree on their columns because they are the same table: same class, same
          fixed layout, and the widths follow from --boss-name-col and the column count, which the
          wrapper sets for both. Nothing measures anything.

          What the split costs is the header association between a mark and its column. Every cell
          already says "Lotus cleared by Alice" for a reader that is not looking at the column (see
          `said` below), so what is lost is a second copy of what the cells carry. */}
      <div className="boss-matrix-head" ref={headRef}>
        <table className="boss-table">
          {columnWidths}
          <thead>
            <tr>
              {/* The word "Boss" said what the column below it holds, which is boss names: it was
                  a label on the self-evident, in a cell as tall as a 96px sprite. The band figures
                  take the space instead. The column still needs a name for a reader who cannot see
                  that, hence the hidden one. */}
              <th className="boss-col-head" scope="col">
                <span className="visually-hidden">Boss</span>
                <BossBands bands={bands} loading={loading} />
              </th>
              {columns.map((character) => (
                <th
                  key={character.id}
                  className={`boss-char-head${doneClass(character.id)}${colClass(character.id)}`}
                  scope="col"
                  title={character.name}
                  onMouseEnter={() => setHoveredColumn(character.id)}
                >
                  {/* The slot is drawn whether or not there is a sprite, so a roster where only some
                    characters have one does not end up with ragged column heads. */}
                  {loading ? (
                    <span className="skeleton sk-face" />
                  ) : character.spriteImgUrl ? (
                    <img
                      className="boss-char-sprite"
                      src={spriteUrl(character.spriteImgUrl)}
                      alt=""
                    />
                  ) : (
                    <span className="boss-char-sprite is-empty" aria-hidden="true" />
                  )}
                  {loading ? (
                    <span className="skeleton sk-line" />
                  ) : (
                    <span className="boss-char-name">{character.name}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
        </table>
      </div>

      {/* The heads above are dragged along by hand. They are in a box of their own now, so the
          browser no longer scrolls the two together. */}
      <div
        className="boss-matrix"
        onScroll={(event) => {
          if (headRef.current) headRef.current.scrollLeft = event.currentTarget.scrollLeft;
        }}
      >
        <table className="boss-table">
          {columnWidths}
          {bands.map(({ cadence, inCadence }) => {
            return (
              <tbody key={cadence}>
                {/* The name alone: the band's count is in the gutter, and saying it twice would
                  be one of the two going stale. What is left is the mark between one band and the
                  next, which the table still has to carry. */}
                <tr className="boss-cadence-row">
                  <th className="boss-cadence" scope="colgroup" colSpan={columns.length + 1}>
                    {/* Pinned on the span, not the cell: the cell spans every column, so it is
                        already at the left edge and has nothing to stick to. */}
                    <span className="boss-cadence-label">{cadenceLabel(cadence)}</span>
                  </th>
                </tr>

                {inCadence.map((boss) => (
                  <tr
                    key={boss.bossKey}
                    // Nothing left to do on this boss, so the row steps back. Two ways to get there
                    // and they are not the same fact: everyone who runs it is done, or nobody runs
                    // it at all. See rowFullyCleared for why an unreported character counts as
                    // neither.
                    className={
                      loading
                        ? undefined
                        : rowNobodyRuns(
                              columns.map((c) => c.id),
                              boss.bossKey,
                              skipsBy,
                            )
                          ? "is-row-unrun"
                          : rowFullyCleared(
                                byCharacter,
                                columns.map((c) => c.id),
                                boss.bossKey,
                                skipsBy,
                              )
                            ? "is-row-cleared"
                            : undefined
                    }
                  >
                    <th className="boss-name" scope="row">
                      {/* Flexed on an inner span, not on the th: display:flex on a table cell takes
                        it out of the table layout and the column stops aligning. */}
                      <span className="boss-name-inner">
                        {/* The game's own portrait, cut from a planner capture, so a row is
                          recognisable before the name is read. The frame is drawn either way, so
                          the loading state and a boss with no art keep the column's width. */}
                        {!loading && boss.iconUrl ? (
                          <img className="boss-portrait" src={apiAssetUrl(boss.iconUrl)} alt="" />
                        ) : (
                          <span className="boss-portrait is-empty" aria-hidden="true" />
                        )}
                        {loading ? <span className="skeleton sk-line" /> : boss.name}
                      </span>
                    </th>
                    {columns.map((character) => {
                      if (loading) {
                        return (
                          <td
                            key={character.id}
                            className={`boss-cell${colClass(character.id)}`}
                            onMouseEnter={() => setHoveredColumn(character.id)}
                          >
                            <span className="skeleton sk-cell" />
                          </td>
                        );
                      }
                      const state = cellState(
                        byCharacter.get(character.id),
                        boss.bossKey,
                        skipsBy.get(character.id),
                      );
                      // Decorative; `said` is what a screen reader gets, and "not reported" is
                      // deliberately not "not cleared". Not-cleared is the empty one of the four:
                      // it is the only state you find by the gap it leaves, and the others have to
                      // be marks so that gap means something.
                      const mark =
                        state === "cleared"
                          ? "✓"
                          : state === "unseen"
                            ? "–"
                            : state === "skipped"
                              ? "·"
                              : "";
                      const said =
                        state === "cleared" || state === "pending"
                          ? `${boss.name} ${cellStateLabel(state)} by ${character.name}`
                          : `${boss.name}, ${character.name} ${cellStateLabel(state)}`;

                      // A boss this character does not run has no clear to tick, so the cell is a
                      // mark and not a control. Which bosses they run is answered on the routine
                      // page, where the whole set is visible at once.
                      const clickable = !!onToggle && state !== "skipped";
                      const title = state === "cleared" ? "Mark not cleared" : "Mark cleared";
                      return (
                        <td
                          key={character.id}
                          // is-editable moves the cell's padding onto the button, so the click
                          // target is the whole cell rather than the glyph in the middle of it.
                          className={`boss-cell is-${state}${clickable ? " is-editable" : ""}${colClass(character.id)}`}
                          onMouseEnter={() => setHoveredColumn(character.id)}
                        >
                          {clickable ? (
                            // The cell IS the control, rather than a mark with a control beside it:
                            // 16 bosses by a roster's worth of columns leaves no room for a second
                            // thing per cell, and the mark is already what you are aiming at.
                            <button
                              type="button"
                              className="boss-mark"
                              disabled={busy}
                              title={title}
                              onClick={() =>
                                onToggle!(character.id, boss.bossKey, nextClear(clearOfCell(state)))
                              }
                            >
                              <span aria-hidden="true">{mark}</span>
                              <span className="visually-hidden">{said}</span>
                            </button>
                          ) : (
                            <>
                              <span aria-hidden="true">{mark}</span>
                              <span className="visually-hidden">{said}</span>
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}

                {/* Under the columns rather than beside the names: the question it answers is "who
                  still has work", and that is read down a character, not across a boss. */}
                {!loading && (
                  <tr className="boss-progress-row">
                    <th className="boss-name" scope="row">
                      Cleared
                    </th>
                    {columns.map((character) => {
                      const progress = clearProgress(
                        statesOf(character.id, inCadence),
                        routineKnown,
                      );
                      return (
                        <td
                          key={character.id}
                          className={`boss-progress-cell${colClass(character.id)}`}
                          onMouseEnter={() => setHoveredColumn(character.id)}
                        >
                          <span aria-hidden="true">{progressMark(progress)}</span>
                          {/* "8/12" is only an answer once you know whose column it is, and a
                            screen reader is not reading the column. */}
                          <span className="visually-hidden">
                            {character.name} {progressLabel(progress)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                )}
              </tbody>
            );
          })}
        </table>
      </div>

      {!loading && historyWeek && bands.length === 0 && (
        <p className="boss-empty-week">No planner was captured this week.</p>
      )}

      {!loading && (
        <>
          <p className="boss-legend">
            {/* Swatches of the cell tints themselves, so the key is the thing rather than a
                description of it. */}
            <span className="boss-key is-cleared">✓</span> {cellStateLabel("cleared")}
            <span className="boss-key is-pending" /> {cellStateLabel("pending")}
            <span className="boss-key is-unseen">–</span> {cellStateLabel("unseen")}: no capture
            this period
            <span className="boss-key is-skipped">·</span> {cellStateLabel("skipped")}
          </p>
          {/* Said, not left as an absence: a reader who knows Zakum is in the catalog should not
              read its missing row as the week having lost it. Why only weekly is answerable is in
              weeklyClearsFor, not on screen. */}
          {historyWeek && <p className="boss-history-note">Weekly bosses only.</p>}
        </>
      )}
    </div>
  );
}
