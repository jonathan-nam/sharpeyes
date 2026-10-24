"use client";

import { type ReactNode, useRef, useState } from "react";
import { CarouselFrame } from "@/components/carousel-frame";
import { KNOWN_CHARACTERS_ID, KnownCharacters } from "@/components/known-characters";
import { spriteUrl } from "@/lib/api";
import { useCarousel } from "@/lib/use-carousel";
import { ConfirmAct } from "@/components/confirm-act";
import { DiscordAvatar } from "@/components/discord-avatar";
import { LinkAccount } from "@/components/link-account";
import { Tooltip } from "@/components/tooltip";
import {
  type PersonDraft,
  characterNote,
  claim,
  contestedOffCard,
  plays,
  sectionsOf,
  stillAttributed,
} from "@/lib/people-board";

// Only our own chips are accepted, so text dragged in from anywhere else is not read as a name.
const DRAG_TYPE = "application/x-character";

/**
 * Who plays which character, as the characters rather than as a list of names.
 *
 * A character moves by being dragged onto whoever plays them. The same move is a click on the chip
 * and then a click on the target, which is also the only way it works from the keyboard: the
 * targets are drawn as buttons for the length of the pickup and are not there otherwise.
 *
 * The pile below holds the characters worth attributing. A character no party has recorded yet is
 * typed into a person's own lane, because a person is the only place this page can keep one: an
 * unattributed name has nowhere to be stored and would not survive the reload.
 */
export function PeopleBoard({
  people,
  unassigned,
  knownCharacters,
  spriteFor,
  busy,
  unsaved,
  inviting,
  onChange,
  onRename,
  onRemove,
  onInvite,
  onLink,
  onCancelLink,
  onUnlink,
}: {
  people: PersonDraft[];
  unassigned: string[];
  /** Every character name the app knows, for the add box to complete against. */
  knownCharacters: string[];
  spriteFor: (name: string) => string | null;
  busy: boolean;
  /**
   * There are edits on this board that are not in the database yet.
   *
   * A link is built from what is SAVED, so offering one over an unsaved rename would hand somebody
   * a roster that does not match the screen it was made from.
   */
  unsaved: boolean;
  /** The person whose link is being made right now, if any. Only their button says so. */
  inviting: string | null;
  onChange: (people: PersonDraft[]) => void;
  onRename: (index: number, name: string) => void;
  onRemove: (index: number) => void;
  onInvite: (personId: string) => void;
  /** Asks an existing account to be this person. Resolves true when sent. */
  onLink: (personId: string, username: string) => Promise<boolean>;
  onCancelLink: (requestId: string) => void;
  /** Takes the account off a person, and their seats in your parties with it. */
  onUnlink: (personId: string) => void;
}) {
  // The character being moved by clicks. Drags carry their own name on the dataTransfer, so this
  // stays null throughout one and the "give it to" buttons never appear mid-drag.
  const [picked, setPicked] = useState<string | null>(null);
  // Which zone the pointer is over, null being the pile. Undefined is no drag in progress.
  const [over, setOver] = useState<number | null | undefined>(undefined);
  // Which person's lane has its add box open. What is typed lives in the box itself.
  const [adding, setAdding] = useState<number | null>(null);

  function pick(name: string) {
    // A lane cannot be typing and receiving at once: both want the last card in the row.
    setAdding(null);
    setPicked(name);
  }

  function place(name: string, personIndex: number | null) {
    setPicked(null);
    setOver(undefined);
    onChange(claim(people, name, personIndex));
  }

  /** Whatever is in the add box goes to that person. Blank is how you back out. */
  function commitAdd(personIndex: number, typed: string) {
    const name = typed.trim();
    setAdding(null);
    if (name !== "") onChange(claim(people, name, personIndex));
  }

  function zoneProps(personIndex: number | null) {
    return {
      className: `person-chips${over !== undefined && over === personIndex ? " is-target" : ""}`,
      onDragOver: (e: React.DragEvent) => {
        if (busy || !e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        setOver(personIndex);
      },
      onDragLeave: () => setOver(undefined),
      onDrop: (e: React.DragEvent) => {
        const name = e.dataTransfer.getData(DRAG_TYPE);
        if (busy || name === "") return;
        e.preventDefault();
        place(name, personIndex);
      },
      // A pickup places on the next click anywhere in the zone, chips included: clicking a second
      // chip while holding one would otherwise swap what you are holding for no reason.
      onClick: () => {
        if (!busy && picked !== null) place(picked, personIndex);
      },
    };
  }

  return (
    <div className={`people-board${picked !== null ? " is-picking" : ""}`}>
      <KnownCharacters names={knownCharacters} />

      {sectionsOf(people).map((section) => (
        <section key={section.title}>
          <h2 className="night-heading people-pool-title">{section.title}</h2>
          <div className="people-list">
            {section.rows.map(({ row, index }) => (
              // A saved person keys on their id; a new row has only its slot.
              <div className="person-row" key={row.id ?? `new-${index}`}>
                {/* Who they are and what you can do about them, in one column. The lane beside it
                takes whatever width is left, which is what keeps every row the same shape however
                many characters a person has. */}
                <div className="person-meta">
                  <label className="person-name-field">
                    <span className="field-label">Name</span>
                    <span className="person-name-line">
                      {row.linked && <DiscordAvatar image={row.image} />}
                      <input
                        className="split-input person-name"
                        value={row.name}
                        onChange={(e) => onRename(index, e.target.value)}
                        placeholder="Felix"
                        maxLength={40}
                      />
                    </span>
                  </label>
                  <div className="person-meta-actions">
                    {/* Only a saved person can be sent one: the link is made from their row in the
                    database, and a row that is not there yet has no id to make it from. */}
                    {row.id != null && (
                      <Tooltip text={unsaved ? "Save first" : undefined}>
                        <button
                          type="button"
                          className="person-invite"
                          disabled={busy || unsaved || inviting !== null}
                          onClick={() => onInvite(row.id as string)}
                        >
                          {/* The wait is here rather than in the dialog, which does not open until there
                          is a link to put in it. The button carries no state beyond that: a link
                          lasts five minutes, so the answer to pressing it again is another link. */}
                          {inviting === row.id ? "Generating..." : "Generate Invite Link"}
                        </button>
                      </Tooltip>
                    )}
                    {!row.linked && row.id != null && (
                      <LinkAccount
                        request={row.request ?? null}
                        busy={busy}
                        unsaved={unsaved}
                        onSend={(username) => onLink(row.id as string, username)}
                        onCancel={onCancelLink}
                      />
                    )}
                    {/* Only where there is an account to take off. A link is a bearer token, so one
                    that reached the wrong person is taken back here rather than being permanent. */}
                    {/* Asks first: it ends the link on both sides at once, and only a new invite
                        undoes it. */}
                    {row.linked && row.id != null && (
                      <ConfirmAct
                        label="Unlink"
                        question={`Unlink ${row.name}?`}
                        keep="Keep"
                        busy={busy}
                        onConfirm={() => onUnlink(row.id as string)}
                      />
                    )}
                    <button
                      type="button"
                      className="party-delete"
                      disabled={busy}
                      onClick={() => onRemove(index)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <TileStrip
                  zone={zoneProps(index)}
                  deps={[row.characters, row.owned, picked, adding]}
                >
                  {/* Their own account's answer, first and unmovable. Nothing here is this account's
                  to reassign, so the card is not a handle and carries no grip. */}
                  {row.owned.map((name) => (
                    <LinkedChip key={name} name={name} sprite={spriteFor(name)} />
                  ))}
                  {/* On their account and another linked one too, so it is nobody's: shown so the clash
                  is not a character quietly missing from the row. */}
                  {contestedOffCard(row).map((name) => (
                    <LinkedChip
                      key={name}
                      name={name}
                      sprite={spriteFor(name)}
                      note={characterNote(row, name)}
                    />
                  ))}
                  {stillAttributed(row).map((name) => (
                    <Chip
                      key={name}
                      name={name}
                      sprite={spriteFor(name)}
                      note={characterNote(row, name)}
                      picked={picked === name}
                      busy={busy}
                      onPick={() => pick(name)}
                    />
                  ))}
                  {picked !== null && !plays(row, picked) && (
                    <Target
                      label={row.name.trim() === "" ? "This row" : row.name}
                      description={`Give ${picked} to ${row.name.trim() === "" ? "this row" : row.name}`}
                    />
                  )}
                  {picked === null && adding === index && (
                    <AddBox
                      person={row.name}
                      onCommit={(name) => commitAdd(index, name)}
                      onCancel={() => setAdding(null)}
                    />
                  )}
                  {picked === null && adding !== index && (
                    <AddCard person={row.name} busy={busy} onOpen={() => setAdding(index)} />
                  )}
                </TileStrip>
              </div>
            ))}
          </div>
        </section>
      ))}

      <h2 className="night-heading people-pool-title">Unassigned Party Members</h2>
      <TileStrip zone={zoneProps(null)} deps={[unassigned, picked]}>
        {unassigned.map((name) => (
          <Chip
            key={name}
            name={name}
            sprite={spriteFor(name)}
            picked={picked === name}
            busy={busy}
            onPick={() => pick(name)}
          />
        ))}
        {picked !== null && !unassigned.includes(picked) && (
          <Target label="Unassign" description={`Take ${picked} off everybody`} />
        )}
      </TileStrip>
    </div>
  );
}

/**
 * One lane of cards: TILES_SHOWN across, arrows for the rest.
 *
 * Its own component so each lane can hold its own scroll position, which a hook called in the
 * board's map could not do. TILES_SHOWN is the number everywhere in this app that puts sprites in a
 * row (lib/carousel.ts); a lane used to wrap instead, so somebody with more characters made their row
 * twice the height of everybody else's and the column of names went ragged.
 *
 * The drop zone is the wrapper rather than the track, so a card dropped on the arrows still lands.
 */
function TileStrip({
  zone,
  deps,
  children,
}: {
  zone: React.HTMLAttributes<HTMLDivElement> & { className: string };
  /** What re-measures the arrows: the cards, and anything that adds or removes one. */
  deps: unknown[];
  children: ReactNode;
}) {
  const carousel = useCarousel(deps);
  return (
    <div {...zone}>
      <CarouselFrame carousel={carousel}>{children}</CarouselFrame>
    </div>
  );
}

/** One character, at the size they are drawn everywhere else. See .roster-sprite. */
function Chip({
  name,
  sprite,
  picked,
  busy,
  onPick,
  note = null,
}: {
  name: string;
  sprite: string | null;
  /** What is wrong with this character, said under its name. */
  note?: string | null;
  picked: boolean;
  busy: boolean;
  onPick: () => void;
}) {
  return (
    <div className="roster-tile">
      <button
        type="button"
        className={`person-card person-chip${picked ? " is-picked" : ""}`}
        draggable={!busy}
        aria-pressed={picked}
        disabled={busy}
        onDragStart={(e) => {
          e.dataTransfer.setData(DRAG_TYPE, name);
          e.dataTransfer.effectAllowed = "move";
        }}
        onClick={onPick}
      >
        {/* The whole card is the handle, so this says so rather than being one. A cursor alone
            only tells you once you are already over it, and never on a touch screen. */}
        <span className="person-grip" aria-hidden="true" />
        {sprite ? (
          <img className="roster-sprite" src={spriteUrl(sprite)} alt="" />
        ) : (
          // The lookup found nothing, or has not run. The frame is drawn anyway so a row of five
          // does not go ragged around the one character nobody could find.
          <span className="roster-sprite is-empty" aria-hidden="true" />
        )}
        <span className="roster-name">{name}</span>
        {note && <span className="person-note">{note}</span>}
      </button>
    </div>
  );
}

/**
 * A character their own account holds, which is not this one's to move.
 *
 * The same card as a Chip without the handle: it is not a button, so there is nothing to press and
 * nothing that looks pressable. What it is doing here is not explained, because the row it sits in
 * already says whose it is and no other card on the page explains itself either.
 */
function LinkedChip({
  name,
  sprite,
  note = null,
}: {
  name: string;
  sprite: string | null;
  note?: string | null;
}) {
  return (
    <div className="roster-tile">
      <div className="person-card person-linked">
        {/* Holds the grip's space so this sits level with the chips beside it, as Target does. */}
        <span className="person-grip" aria-hidden="true" />
        {sprite ? (
          <img className="roster-sprite" src={spriteUrl(sprite)} alt="" />
        ) : (
          <span className="roster-sprite is-empty" aria-hidden="true" />
        )}
        <span className="roster-name">{name}</span>
        {note && <span className="person-note">{note}</span>}
      </div>
    </div>
  );
}

/**
 * Where the character you are holding can go, for the length of the pickup only.
 *
 * The zone around it takes the click, so this is a label that happens to be focusable rather than
 * a control of its own. It exists because a drop zone cannot be tabbed to.
 */
function Target({ label, description }: { label: string; description: string }) {
  return (
    <div className="roster-tile">
      <button type="button" className="person-card person-target" aria-label={description}>
        {/* Holds the grip's space so this sits level with the cards beside it. Nothing to grab. */}
        <span className="person-grip" aria-hidden="true" />
        <span className="roster-sprite is-empty" aria-hidden="true" />
        <span className="roster-name">{label}</span>
      </button>
    </div>
  );
}

/** The last card in a person's lane: a character no party has recorded for them yet. */
function AddCard({ person, busy, onOpen }: { person: string; busy: boolean; onOpen: () => void }) {
  return (
    <div className="roster-tile">
      <button
        type="button"
        className="person-card person-add"
        disabled={busy}
        aria-label={`Add a character for ${person.trim() === "" ? "this row" : person}`}
        onClick={onOpen}
      >
        <span className="person-grip" aria-hidden="true" />
        <span className="roster-sprite is-empty person-add-mark" aria-hidden="true">
          +
        </span>
        <span className="roster-name">Character</span>
      </button>
    </div>
  );
}

/**
 * The same card with a name box in it.
 *
 * Blur commits rather than cancels: what is typed is one short name, and losing it to a stray click
 * is the worse of the two ways to be wrong. Escape is the way to back out.
 *
 * The name is held here rather than by the board, and the flag is what keeps Escape from committing
 * anyway: closing the box takes the focus out of it, and the blur that follows would otherwise
 * write the very value that was just discarded.
 */
function AddBox({
  person,
  onCommit,
  onCancel,
}: {
  person: string;
  onCommit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const cancelled = useRef(false);

  return (
    <div className="roster-tile">
      <div className="person-card person-add is-typing">
        <span className="person-grip" aria-hidden="true" />
        <span className="roster-sprite is-empty" aria-hidden="true" />
        <input
          className="split-input person-add-input"
          value={value}
          list={KNOWN_CHARACTERS_ID}
          autoFocus
          maxLength={40}
          aria-label={`Character ${person.trim() === "" ? "this row" : person} plays`}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => {
            if (!cancelled.current) onCommit(value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") onCommit(value);
            if (e.key === "Escape") {
              cancelled.current = true;
              onCancel();
            }
          }}
        />
      </div>
    </div>
  );
}
