"use client";

import { IconSelect } from "@/components/icon-select";
import { apiAssetUrl } from "@/lib/api";
import { PLACEHOLDER, dropOptions } from "@/lib/drop-select";
import type { WorldType } from "@/lib/world";
import type { BossDrop } from "@/types/drop";

// Which drop fell, picked by its art.
//
// A coupon is recognised by its icon long before its name is read, and "Whisper of the Source"
// versus "Grindstone of Life" is a slower read than two pictures. The listbox is IconSelect's.

export function DropSelect({
  drops,
  worldType,
  value,
  onChange,
  label,
}: {
  /** Already narrowed to the party's world. See pickableDrops. */
  drops: BossDrop[];
  worldType: WorldType;
  /** A drop key, OTHER, or "" for nothing picked yet. */
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const options = dropOptions(drops, worldType).map((option) => ({
    ...option,
    iconUrl: option.iconUrl ? apiAssetUrl(option.iconUrl) : null,
  }));
  return (
    <IconSelect
      options={options}
      placeholder={PLACEHOLDER}
      value={value}
      onChange={onChange}
      label={label}
    />
  );
}
