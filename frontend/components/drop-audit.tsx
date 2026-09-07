import Link from "next/link";
import { apiAssetUrl } from "@/lib/api";
import { formatWeekStart } from "@/lib/boss-clears";
import { formatMesos } from "@/lib/drop-split";
import { formatMoney } from "@/lib/money";
import { formatDroppedWithYear } from "@/lib/loot";
import { worldLabel } from "@/lib/world";
import type { AuditEvent, DropAudit } from "@/lib/drop-audit";

// One drop's history. Every figure comes off lib/drop-audit.ts, which comes off splitOf() and the
// log's own entry: nothing here adds anything up.

/** The day part of a timestamp, with its year. A history of days, like the offsets list. */
const dayOf = (at: string) => formatDroppedWithYear(at.slice(0, 10));

/** The act, in one word where one word will do. */
function what(event: AuditEvent): string {
  switch (event.kind) {
    case "DROPPED":
      return "Dropped";
    case "HELD":
      return "Looted";
    case "SOLD":
      return "Sold";
    case "TAKEN":
      return "Taken";
    case "PAID":
      return "Paid";
    case "OFFSET":
      return "Offset";
    case "SETTLED":
      return "Settled";
    case "OWED":
      return "Owed";
  }
}

/** Who and what, on the same line. Never why: the figure beside it is the effect. */
function detail(event: AuditEvent, audit: DropAudit): React.ReactNode {
  switch (event.kind) {
    case "DROPPED":
      // The one link off this page, and only where there is somewhere to go: the boss names the
      // party the drop fell in, which is its neighbours. A retired config is on no list, so its
      // name is said and not linked. See DropAudit.partyRetired.
      return (
        <>
          {audit.partyRetired ? (
            <span className="loot-name">{event.boss ?? "Unknown boss"}</span>
          ) : (
            <Link href={`/bosses/parties/${audit.partySlug}`} className="loot-name">
              {event.boss ?? "Unknown boss"}
            </Link>
          )}
          {event.ranWith.length > 0 && ` with ${event.ranWith.join(", ")}`}
        </>
      );
    case "HELD":
      return event.yours
        ? `${event.other} picked up ${event.pieces} of yours`
        : `you picked up ${event.pieces} of ${event.other}'s`;
    case "SOLD": {
      const price = formatMoney(event.amount, event.currency, true);
      const by = event.seller ?? "somebody who has left";
      if (event.basis === "BOUGHT") return `bought by ${by} for ${price}`;
      return `${event.basis === "LISTED" ? "listed at" : "received"} ${price} by ${by}`;
    }
    case "TAKEN":
      return event.by;
    case "PAID":
    case "OWED":
      return event.who;
    case "OFFSET":
      return `against ${event.who}`;
    case "SETTLED":
      return `with ${event.who}`;
  }
}

/** What the act moved. Nothing where it moved nothing: a taken drop owes nobody anything. */
function figure(event: AuditEvent): React.ReactNode {
  switch (event.kind) {
    case "DROPPED":
      // Nothing. What fell is the title, and how many of it fell is beside the title: a count here
      // as well was the same fact twice on one screen.
      return null;
    case "HELD":
      return (
        <>
          <span className="droplog-take">{event.pieces}</span>
          <span className="loot-share-nets">coupons</span>
        </>
      );
    case "SOLD":
      // Your side of it over what there was to split, the pair the Settled row carries. Neither is
      // readable when the split names a seat that has left, and the row says so rather than
      // showing the price as though it were yours.
      return event.pooled === null || event.yourTake === null ? (
        <span className="loot-share-nets">split unreadable</span>
      ) : (
        <>
          <span className="droplog-take">{formatMoney(event.yourTake, event.currency, true)}</span>
          <span className="loot-share-nets">
            of {formatMoney(event.pooled, event.currency, true)}
          </span>
        </>
      );
    case "TAKEN":
      return <span className="loot-share-nets">nothing owed</span>;
    case "PAID":
    case "OWED":
      return (
        <span className="droplog-take">{formatMoney(event.amount, event.currency, true)}</span>
      );
    case "OFFSET":
      return event.amount === null ? (
        <span className="loot-share-nets">split unreadable</span>
      ) : (
        <span className="droplog-take">{formatMoney(event.amount, event.currency, true)}</span>
      );
    case "SETTLED":
      return (
        <>
          <span className="droplog-take">{event.pieces}</span>
          <span className="loot-share-nets">
            {event.writtenOff > 0
              ? `coupons, ${formatMesos(event.writtenOff, true)} written off`
              : "coupons"}
          </span>
        </>
      );
  }
}

export function DropAuditView({ audit }: { audit: DropAudit }) {
  // Your share OUT OF what fell, worded as the pool row words it, and for the same reason: the two
  // numbers side by side made the reader subtract. Said only where they differ, so a drop that came
  // out even keeps the plain count. See loot-row.tsx.
  const share = audit.yours === audit.quantity ? null : audit.yours;
  // Facts, joined the way a pool row's meta joins them. The boss and the day are the DROPPED row's
  // and are not repeated here.
  const meta = [
    audit.character,
    worldLabel(audit.worldType),
    `Week of ${formatWeekStart(audit.weekStart)}`,
  ];

  return (
    <>
      <h1 className="page-title">
        {audit.iconUrl && <img className="loot-icon" src={apiAssetUrl(audit.iconUrl)} alt="" />}
        {audit.name}
        {share !== null ? (
          <span className="loot-count">
            {" "}
            {share} out of {audit.quantity}
          </span>
        ) : (
          audit.quantity > 1 && <span className="loot-count"> x{audit.quantity}</span>
        )}
        {/* Where the drop stands now. The list says what happened; without this the reader works
            that out by finding the last row and knowing which acts end a drop. */}
        <span className={`loot-status is-${audit.status.toLowerCase()}`}>{audit.stage}</span>
      </h1>
      <p className="audit-meta">{meta.filter(Boolean).join(" · ")}</p>

      <ul className="audit-list">
        {audit.events.map((event) => (
          <li
            key={event.key}
            className={event.at === null ? "audit-row is-undated" : "audit-row"}
            data-kind={event.kind}
          >
            {/* Blank where the act has no date, never a guessed one. Only three acts can be
                undated, and each of them says why in its own words. */}
            <span className="audit-when">{event.at === null ? "" : dayOf(event.at)}</span>
            <span className="audit-what">{what(event)}</span>
            <span className="audit-detail">{detail(event, audit)}</span>
            <span className="droplog-amounts">{figure(event)}</span>
          </li>
        ))}
      </ul>
    </>
  );
}
