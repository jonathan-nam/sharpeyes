"use client";

import { Fragment, useEffect, useState } from "react";

import { DropPicker } from "@/components/drop-picker";
import { LootRotation } from "@/components/loot-rotation";
import { SAVED_BUT_STALE, StaleAfterWrite, apiAssetUrl } from "@/lib/api";
import { BOSS_ART_2X } from "@/lib/boss-art";
import { clearStateLabel, nextClear } from "@/lib/boss-clears";
import { bossLabel } from "@/lib/boss-difficulty";
import {
  formatDuration,
  type NightPerson,
  planAsText,
  planGrid,
  type RunTime,
  runTicks,
  runTimes,
} from "@/lib/boss-night";
import type { Plan } from "@/lib/boss-run-plan";
import { poolSize } from "@/lib/loot";
import type { Rotation } from "@/lib/loot-rotation";
import type { BossDrop } from "@/types/drop";
import type { AddLootBody } from "@/types/loot";
import type { Party } from "@/types/party";

/** Names as a person would say them: "Rinlow", "Rinlow and Kade", "Rinlow, Kade and Bel". */
function said(names: string[]): string {
  if (names.length < 2) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/**
 * "Rinlow is free at +3:00".
 *
 * The only sentence this page draws, and it is here because the alternative is worse: a schedule
 * that jumps from +2:50 to +3:00 with a twenty minute run above it is either a rounding error or a
 * wait, and nothing on the row says which.
 */
function waitLine(time: RunTime): string {
  const names = time.waitingFor.map((person) => person.name);
  if (names.length === 1) return `${names[0]} is free at ${time.at}`;
  return `${said(names)} are free at ${time.at}`;
}

/**
 * Answering for a run without leaving the order.
 *
 * The row is answered through its CONFIG, the same Party the boss rows on Party View carry, so a
 * boss ticked here and one ticked there are the same boss_clear row and a drop logged here lands
 * in the same pool. Absent for a hand-typed night: there is no config behind those rows, so there
 * is nothing to write to and no controls are drawn.
 */
export type RunLog = {
  /** The config a planned run came from, by run id. */
  partyOf: (runId: string) => Party | undefined;
  /**
   * Whose turn it is on this run's pieces, or null for a boss with nothing to rotate.
   *
   * Drawn in the row's panel, not on the grid. Keyed by nothing: the panel is a list of people, so
   * the rotation's own holders are the right shape and a person's two characters are one turn.
   */
  rotationOf: (runId: string) => Rotation | null;
  /** That boss's drop table, for the picker. Undefined leaves it offering "something else". */
  dropTable: (bossKey: string) => BossDrop[] | undefined;
  /** THIS config's write, not the page's: one row saving must not dim the rest of the night. */
  busy: (partyId: string) => boolean;
  onToggleClear: (party: Party, cleared: boolean) => void;
  /** Omitted where the catalog's tables never loaded, which a picker cannot do without. */
  onAddDrop?: (party: Party, body: AddLootBody) => Promise<void>;
};

/**
 * The night, in order: bosses down the rows, people across the columns.
 *
 * The cell is the character that person brings, or an X where they sit the run out. Both halves
 * matter once the group is bigger than a party, and a list of the seats in each run could only
 * ever show the first. See planGrid.
 *
 * A switch is the one coloured thing here, because it is the one thing the ordering exists to
 * minimise, and it is marked on the cell that moved rather than counted at the end of the row.
 *
 * The clock is a RULE ACROSS THE TABLE every half hour, not a time on every row. A party arranges
 * itself in half hours, so a column of +4:55s was a precision nobody was speaking in, and the row
 * only ever needed to say which half hour it fell in. What the row still carries is its own length,
 * which is the part a reader is actually adding up. The exact start is on the row's tooltip, and
 * nowhere else: the paste is the order alone. See planAsText.
 */
export function RunPlan({
  plan,
  roster,
  startAt,
  timed = true,
  log,
}: {
  plan: Plan;
  roster: NightPerson[];
  startAt: number;
  /** Off where the night is an order rather than a schedule: no times, no lengths, no waits. */
  timed?: boolean;
  /** Absent for a hand-typed night, which has no config to answer for. See RunLog. */
  log?: RunLog;
}) {
  const { people, rows } = planGrid(plan, roster);
  const times = timed ? runTimes(plan, roster, startAt) : [];
  const ticks = runTicks(times);

  // A row band alone answers "which boss", not "which person": the header sits rows away, so
  // reading a cell still means tracing a column by eye. CSS can do a row on its own and cannot do
  // a column, hence the state. Same reason the boss matrix carries one.
  const [hovered, setHovered] = useState<string | null>(null);
  // One at a time. Two open pickers is two forms competing for the same night, and the panel is a
  // full-width row that pushes the rest of the order down the page.
  const [opened, setOpened] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  // The rule and the wait rows span the table, so they have to count the clear column too.
  const width = people.length + 1 + (log ? 1 : 0);

  return (
    // Cleared here rather than per cell, so leaving one cell for its neighbour does not blank the
    // band between the two events.
    <div className="run-grid" onMouseLeave={() => setHovered(null)}>
      <table className="run-table">
        <thead>
          <tr>
            <th className="run-col-head" scope="col">
              Boss
            </th>
            {people.map((person) => (
              <th
                key={person.id}
                className={
                  hovered === person.id ? "run-person-head is-col-hover" : "run-person-head"
                }
                scope="col"
                title={person.name}
                onMouseEnter={() => setHovered(person.id)}
              >
                {person.name}
              </th>
            ))}
            {log && (
              <th className="run-clear-head" scope="col">
                Cleared
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ planned, cells }, row) => {
            const time = times[row];
            const tick = ticks[row];
            const party = log?.partyOf(planned.run.id);
            const rotation = log?.rotationOf(planned.run.id) ?? null;
            const pool = party ? poolSize(party) : 0;
            // Every drop, not just the outstanding ones, but quietly once there is nothing left to
            // do with them. Same two states the party row's summary has.
            const settled = party !== undefined && party.pendingLoot + party.awaitingPayout === 0;
            const onAddDrop = log?.onAddDrop;
            const open = opened === planned.run.id;
            const rowClasses = [];
            // Striped from the row's own index rather than :nth-child, which counts the wait and
            // rule rows above and flips the banding under every gap.
            if (row % 2 === 1) rowClasses.push("is-banded");
            // Strictly `=== true`, as the party row is: null is "nothing has said", which is a run
            // still to do and not a finished one.
            if (party?.cleared === true) rowClasses.push("is-done");
            if (open) rowClasses.push("is-open");
            return (
              <Fragment key={planned.run.id}>
                {/* Above the wait, because the wait is what carried the night into this half hour
                    and reads as the reason the rule is where it is. */}
                {tick != null && (
                  <tr className="run-tick">
                    <td colSpan={width}>
                      <span className="run-tick-at">{tick}</span>
                    </td>
                  </tr>
                )}
                {time !== undefined && time.waitingFor.length > 0 && (
                  <tr className="run-wait">
                    <td colSpan={width}>{waitLine(time)}</td>
                  </tr>
                )}
                <tr className={rowClasses.join(" ") || undefined}>
                  <th
                    className="run-boss"
                    scope="row"
                    title={
                      time === undefined ? undefined : `Starts ${time.approx ? "~" : ""}${time.at}`
                    }
                  >
                    {/* Flexed on an inner span: display:flex on a table cell takes it out of the
                    table layout and the columns stop aligning. */}
                    <span className="run-boss-inner">
                      {/* Same chevron as a party row, in the same place, because it opens the same
                          picker onto the same pool. Absent with no config behind the row, and the
                          width is not held open for it: every row of an account night has one. */}
                      {party && onAddDrop && (
                        <button
                          type="button"
                          className="party-row-toggle"
                          aria-expanded={open}
                          aria-controls={`run-panel-${planned.run.id}`}
                          onClick={() => {
                            setOpened(open ? null : planned.run.id);
                            setAddError(null);
                          }}
                        >
                          <span className="party-row-chevron" aria-hidden="true" />
                          {/* A disclosure rather than "Add a drop": the panel holds whose turn it
                              is on the pieces as well as the picker. */}
                          <span className="visually-hidden">
                            {open ? "Hide this run's loot" : "Show this run's loot"}
                          </span>
                        </button>
                      )}
                      {BOSS_ART_2X[planned.run.bossKey] ? (
                        <img
                          className="run-art"
                          src={apiAssetUrl(BOSS_ART_2X[planned.run.bossKey] as string)}
                          alt=""
                          width={40}
                          height={40}
                        />
                      ) : (
                        <span className="run-art is-empty" aria-hidden="true" />
                      )}
                      <span className="run-boss-text">
                        <span className="run-boss-name">
                          {bossLabel(planned.run.bossName, planned.run.difficulty)}
                        </span>
                        {/* A tilde where nobody has timed this party, so a guessed half hour and a
                        measured one are not read as the same claim. */}
                        {timed && (
                          <span className="run-boss-minutes">
                            {`${planned.run.assumed ? "~" : ""}${formatDuration(planned.run.minutes)}`}
                          </span>
                        )}
                        {/* What the pool holds, as a bare count. Party View's wording ("1 in the
                            pool") is a line of its own there and wrapped the boss name onto a
                            second line here. It counts the
                            whole pool rather than tonight: a pool is not per night, and a badge
                            that emptied at reset would be a number about the week dressed as a
                            number about the run. */}
                        {pool > 0 && (
                          <span
                            className={
                              settled
                                ? "run-pool party-loot-summary is-done"
                                : "run-pool party-loot-summary"
                            }
                          >
                            {pool}
                          </span>
                        )}
                      </span>
                    </span>
                  </th>

                  {cells.map((cell, i) => {
                    const person = people[i] as NightPerson;
                    const classes = ["run-cell"];
                    if (cell.character === null) classes.push("is-out");
                    if (cell.switched) classes.push("is-switch");
                    if (hovered === person.id) classes.push("is-col-hover");
                    return (
                      <td
                        key={person.id}
                        className={classes.join(" ")}
                        title={
                          cell.switched ? `${person.name} switches to ${cell.character}` : undefined
                        }
                        onMouseEnter={() => setHovered(person.id)}
                      >
                        {cell.character === null ? (
                          <>
                            <span aria-hidden="true">&#10005;</span>
                            <span className="visually-hidden">Not running</span>
                          </>
                        ) : (
                          <>
                            {cell.switched && (
                              <span className="run-swap" aria-hidden="true">
                                &#8644;{" "}
                              </span>
                            )}
                            {cell.character}
                          </>
                        )}
                      </td>
                    );
                  })}

                  {/* A tick or nothing, not the word. Party View's three-state pill says which of
                      "not cleared" and "not reported" a row is; here the filter above means every
                      row is one of the two, so a column of them was the same word three times.
                      Done is the mark and still-to-do is the gap, which is the reading the boss
                      matrix's cells already use.

                      The distinction is not lost, it is just not drawn: the label under the mark
                      still names the state a screen reader is given. A run with no config behind
                      it keeps an empty cell rather than losing it, or the grid goes ragged. */}
                  {log && (
                    <td className="run-clear-cell">
                      {party && (
                        <button
                          type="button"
                          className={party.cleared === true ? "run-mark is-cleared" : "run-mark"}
                          disabled={log.busy(party.id)}
                          onClick={() => log.onToggleClear(party, nextClear(party.cleared))}
                          title={party.cleared === true ? "Mark not cleared" : "Mark cleared"}
                        >
                          <span aria-hidden="true">&#10003;</span>
                          <span className="visually-hidden">{clearStateLabel(party.cleared)}</span>
                        </button>
                      )}
                    </td>
                  )}
                </tr>

                {/* A row of its own across the table, the way the rule and the wait are: a picker
                    inside a cell would be laid out by the column it is in. */}
                {open && party && log && onAddDrop && (
                  <tr className="run-panel">
                    <td colSpan={width} id={`run-panel-${planned.run.id}`}>
                      {/* Whose turn it is, ahead of the picker, in the order Party View puts them:
                          what to pick up is what you read before bending down. It frames itself,
                          the DROP heading it with its own art. */}
                      {rotation && <LootRotation rotation={rotation} />}
                      {/* Only alongside a rotation, where two blocks in one panel need telling
                          apart. On its own the chevron has already said what the panel is. */}
                      {rotation && <h3 className="loot-group-title">Add Drop</h3>}
                      <DropPicker
                        bossKey={party.bossKey}
                        worldType={party.worldType}
                        table={log.dropTable(party.bossKey)}
                        difficulty={party.difficulty}
                        busy={log.busy(party.id)}
                        onAdd={async (body) => {
                          setAddError(null);
                          try {
                            await onAddDrop(party, body);
                          } catch (e) {
                            // Landed, and only the plan behind it is stale. Re-arming the picker
                            // over one is what logged a drop twice. See StaleAfterWrite.
                            if (e instanceof StaleAfterWrite) {
                              setAddError(SAVED_BUT_STALE);
                              return;
                            }
                            setAddError("That didn't save.");
                            // Rethrown so the picker keeps what was chosen, ready to try again.
                            throw e;
                          }
                        }}
                      />
                      {addError && <p className="split-error">{addError}</p>}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** The plan as text on the clipboard, which is where a party actually reads it. */
export function CopyPlan({ plan, roster }: { plan: Plan; roster: NightPerson[] }) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1200);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <button
      type="button"
      className={copied ? "copy-amount copied" : "copy-amount"}
      onClick={() => {
        navigator.clipboard
          ?.writeText(planAsText(plan, roster))
          .then(() => setCopied(true))
          .catch(() => setCopied(false));
      }}
    >
      <span className="copy-value">{copied ? "Copied" : "Copy the order"}</span>
    </button>
  );
}
