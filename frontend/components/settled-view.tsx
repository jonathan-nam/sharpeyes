"use client";

import Link from "next/link";
import { useState } from "react";
import { apiAssetUrl } from "@/lib/api";
import { bossLabel } from "@/lib/boss-difficulty";
import { formatMesos } from "@/lib/drop-split";
import { formatDollars, formatMoney } from "@/lib/money";
import { formatDropped } from "@/lib/loot";
import { consolidateSettled } from "@/lib/settled-log";
import type { SettledLine, SettledRecord, SettledTotals } from "@/lib/settled-log";
import type { DropLogTotals } from "@/lib/drop-log";
import type { Boss } from "@/types/boss";
import type { Party } from "@/types/party";

// What is finished, and how it got that way.
//
// The one tab that asks nothing. Every other ledger is a worklist, so a row on it is something to
// do; a row here is something that happened, and the only control on it undoes the act that put it
// there. That is what lets the first three stop carrying finished rows.
//
// Nothing here computes a figure. Every number comes off lib/settled-log.ts, which comes off the
// Drop Log's own entries, which is splitOf()'s money and couponGapOf()'s pieces.

/**
 * How a row was finished, in the fewest words the line can carry.
 *
 * Said on the row rather than as a column, because the three are not variants of one fact: a payout
 * has a date and a party, a coupon night has a date and one person, and a taken drop has neither. A
 * column would have to be blank on two of them.
 */
function endedWith(row: SettledRecord): string | null {
  if (row.takenBy !== null) return `taken by ${row.takenBy}`;
  if (row.kind === "PIECES")
    return row.settledOn
      ? `settled with ${row.holderName} ${formatDropped(row.settledOn.slice(0, 10))}`
      : `settled with ${row.holderName}`;
  return row.settledOn ? `paid out ${formatDropped(row.settledOn.slice(0, 10))}` : "paid out";
}

/** The nights behind a fold, indented one step the way the Drop Log's runs are. */
function SettledNights({
  records,
  bossByKey,
  partyById,
  id,
}: {
  records: SettledRecord[];
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
  id: string;
}) {
  return (
    <ul className="droplog-runs" id={id}>
      {records.map((row) => {
        const boss = bossByKey.get(row.bossKey ?? "") ?? null;
        const party = partyById.get(row.partyId) ?? null;
        return (
          <li key={row.key} className="droplog-run">
            {/* The night's own history, not the party's: one of these rows IS one drop, and the
                party it fell in is every drop that boss ever gave you. */}
            <Link href={`/bosses/drops/${row.lootId}`} className="loot-name">
              {boss ? bossLabel(boss.name, party?.difficulty ?? null) : "Unknown boss"}
            </Link>
            <span className="loot-meta">{formatDropped(row.droppedOn)}</span>
            {/* The same wrapper the Drop Log's runs put their figures in, so the counts line up down
                the right the way those do. */}
            <span className="droplog-amounts">
              <span className="droplog-take">{row.pieces}</span>
              <span className="loot-share-nets">coupons</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function SettledRow({
  line,
  bossByKey,
  partyById,
}: {
  line: SettledLine;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
}) {
  const [open, setOpen] = useState(false);
  const row = line.records[0]!;
  const boss = bossByKey.get(row.bossKey ?? "") ?? null;
  const party = partyById.get(row.partyId) ?? null;
  const panelId = `settled-nights-${line.key}`;
  const nights = `${line.records.length} nights`;
  // A fold stands for several nights, so it names what they have in common (the act) and counts the
  // rest. Naming one boss and one date would be naming one night out of five.
  const meta = line.folded
    ? [nights, endedWith(row)].filter(Boolean)
    : [
        boss ? bossLabel(boss.name, party?.difficulty ?? null) : null,
        formatDropped(row.droppedOn),
        row.sale?.seller
          ? `${row.sale.basis === "BOUGHT" ? "bought by" : "sold by"} ${row.sale.seller}`
          : null,
        endedWith(row),
      ].filter(Boolean);

  return (
    <li className={`droplog-row${open ? " is-open" : ""}`}>
      <div className="droplog-row-head">
        {row.iconUrl ? (
          <img className="loot-icon" src={apiAssetUrl(row.iconUrl)} alt="" />
        ) : (
          <span className="loot-icon" aria-hidden="true" />
        )}

        <span className="droplog-title">
          <span className="droplog-name-line">
            {/* A fold stands for several drops, so its name links to none of them: it would open
                whichever happened to be first. The nights below carry the links, and the chevron
                beside the name is what opens onto them. */}
            {line.folded ? (
              <>
                <span className="loot-name">{row.name}</span>
                <button
                  type="button"
                  className="party-row-toggle"
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpen((o) => !o)}
                >
                  <span className="party-row-chevron" aria-hidden="true" />
                  <span className="visually-hidden">
                    {open ? `Hide ${nights}` : `Show ${nights}`}
                  </span>
                </button>
              </>
            ) : (
              <Link href={`/bosses/drops/${row.lootId}`} className="loot-name">
                {row.name}
                {row.quantity > 1 && <span className="loot-count"> x{row.quantity}</span>}
              </Link>
            )}
          </span>
          <span className="loot-meta">{meta.join(" · ")}</span>
        </span>

        <span className="droplog-amounts">
          {row.kind === "MONEY" && row.sale?.pooled !== null && row.sale !== null ? (
            <>
              <span className="droplog-take">
                {formatMoney(row.sale.yourTake ?? 0, row.sale.currency, true)}
              </span>
              <span className="loot-share-nets">
                of {formatMoney(row.sale.pooled, row.sale.currency, true)}
              </span>
            </>
          ) : row.kind === "PIECES" ? (
            <>
              <span className="droplog-take">{line.pieces}</span>
              <span className="loot-share-nets">
                {/* A write-off is a decision, so it is said on the line it was made about, which for
                    a fold is the act that made it. */}
                {line.writtenOff > 0
                  ? `coupons, ${formatMesos(line.writtenOff, true)} written off`
                  : "coupons"}
              </span>
            </>
          ) : (
            <span className="loot-share-nets">nothing owed</span>
          )}
        </span>
      </div>

      {/* One act closed all of these. The nights are here to be read: nothing on this tab is acted
          on, one at a time or otherwise. */}
      {line.folded && open && (
        <SettledNights
          records={line.records}
          bossByKey={bossByKey}
          partyById={partyById}
          id={panelId}
        />
      )}
    </li>
  );
}

/**
 * The three figures this page is read for, above the rows they are the sum of.
 *
 * Drops counts the WHOLE log while the money counts the settled rows, so the three are not one
 * population and do not add up.
 *
 * Drawn even when nothing is settled. An account that has logged drops and settled none would
 * otherwise lose the count altogether, and a zero is an answer where a missing tile is not.
 */
function SettledTiles({
  logged,
  totals,
  money,
}: {
  logged: DropLogTotals;
  totals: SettledTotals;
  money: boolean;
}) {
  return (
    <div className="stat-row">
      <div className="stat-tile">
        <span className="stat-label">Drops</span>
        <span className="stat-value">{logged.drops}</span>
      </div>

      {/* Only where there is money to talk about. A Heroic account trades nothing, so both of these
          would be true zeroes wearing a label about selling. */}
      {money && (
        <>
          <div className="stat-tile">
            <span className="stat-label">Total Sales</span>
            {/* The figure is what there was to SPLIT (Split.sellerReceives), not the sum of the
              sale prices as entered: a listed price and a received one sit either side of the
              Auction House fee, and adding them is the confident wrong number this repo exists to
              prevent. See the header of lib/drop-log.ts. */}
            <span className="stat-value is-good">{formatMesos(totals.pooled, true)}</span>
            {/* Under the mesos, never folded into them. Only when there is one: a $0.00 on every
                account that has never sold for real money would be a unit nobody uses, stated
                everywhere. See lib/money.ts. */}
            {totals.usd.pooled > 0 && (
              <span className="stat-usd">{formatDollars(totals.usd.pooled)}</span>
            )}
          </div>
          <div className="stat-tile">
            <span className="stat-label">My Share</span>
            <span className="stat-value is-good">{formatMesos(totals.yourTake, true)}</span>
            {totals.usd.yourTake > 0 && (
              <span className="stat-usd">{formatDollars(totals.usd.yourTake)}</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function SettledView({
  rows,
  totals,
  logged,
  money,
  orphans,
  bossByKey,
  partyById,
}: {
  rows: SettledRecord[];
  totals: SettledTotals;
  /** The whole log's counts, which the Drop Ledger used to head itself with. See SettledTiles. */
  logged: DropLogTotals;
  /** Whether this world trades at all. Two of the three tiles are about selling. */
  money: boolean;
  /** Settlements naming a drop the pool no longer has. Said, never absorbed. See orphansOf. */
  orphans: number;
  bossByKey: Map<string, Boss>;
  partyById: Map<string, Party>;
}) {
  if (rows.length === 0) {
    return (
      <>
        <SettledTiles logged={logged} totals={totals} money={money} />
        <p className="party-hint">Nothing settled yet.</p>
      </>
    );
  }

  return (
    <>
      {/* Above the section, not inside it. The tiles are what the page is read for, and the rows
          below are what they are the sum of. */}
      <SettledTiles logged={logged} totals={totals} money={money} />

      <section className="loot-pool">
        <header className="droplog-group-head">
          {/* The heading alone. What was split and your share of it stood here too, and they are the
              second and third tiles now: a figure said twice on one screen is a figure a reader has
              to check against itself. Both carry the coupon lots, which are on no row below. See
              SettledTotals.pooled. */}
          <h2 className="loot-pool-title">Settled</h2>
        </header>

        <ul className="droplog-list">
          {consolidateSettled(rows).map((line) => (
            <SettledRow key={line.key} line={line} bossByKey={bossByKey} partyById={partyById} />
          ))}
        </ul>

        {/* Money missing from the totals above, said where those totals are. It was the Drop Ledger's
          note until that page stopped stating a meso. Same shape as the orphan count below: an
          absence nothing says is the silent wrong number. */}
        {totals.unreadable > 0 && (
          <p className="loot-warn droplog-note">
            {totals.unreadable} sold{" "}
            {totals.unreadable === 1 ? "drop names a seat" : "drops name seats"} that has left, so{" "}
            {totals.unreadable === 1 ? "its split cannot" : "their splits cannot"} be read and{" "}
            {totals.unreadable === 1 ? "its" : "their"} money is in neither total above.
          </p>
        )}

        {orphans > 0 && (
          <p className="loot-warn droplog-note">
            {orphans} {orphans === 1 ? "settlement names a drop" : "settlements name drops"} the
            pool no longer has, so {orphans === 1 ? "it is" : "they are"} not listed.
          </p>
        )}
      </section>
    </>
  );
}
