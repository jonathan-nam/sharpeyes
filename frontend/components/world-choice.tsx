"use client";

import { WORLDS_IN, emblemFor } from "@/lib/world-names";
import { WORLD_TYPES, worldLabel, type WorldType } from "@/lib/world";

/**
 * Which world the account plays in, one card per world.
 *
 * A player knows they log into Scania; whether Nexon files that under Interactive is our word for
 * it, so the category is the card's second line rather than the choice. The account stores only the
 * category (users.world_type), so the caller decides which world reads as picked and does the save.
 */
export function WorldChoice({
  chosen,
  busy,
  onChoose,
}: {
  /** The world drawn as picked, by name. */
  chosen: string | null;
  busy: boolean;
  onChoose: (world: string, type: WorldType) => void;
}) {
  return (
    <section className="world-choice">
      <h2 className="welcome-step-title">Which world do you play in?</h2>
      <div className="world-choice-cards">
        {WORLD_TYPES.flatMap((type) =>
          WORLDS_IN[type].map((world) => (
            <button
              key={world}
              type="button"
              className={world === chosen ? "world-choice-card is-chosen" : "world-choice-card"}
              aria-pressed={world === chosen}
              disabled={busy}
              onClick={() => onChoose(world, type)}
            >
              {/* Each world's own emblem from the game's world select. See
                  scripts/build-world-emblems.mjs for where they are cut from. */}
              <img className="world-emblem" src={emblemFor(world)} alt="" />
              <span className="world-choice-name">{world}</span>
              <span className="world-choice-worlds">{worldLabel(type)}</span>
            </button>
          )),
        )}
      </div>
    </section>
  );
}
