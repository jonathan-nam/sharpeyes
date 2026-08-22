// Mirrors backend's users/SettingsRoutes.kt SettingsResponse field-for-field.

import type { WorldType } from "@/lib/world";

export type Settings = {
  // Which world the site is answering for. Every account-wide list is narrowed to it server-side,
  // so it is not a preference, it is what the numbers on screen are numbers OF.
  worldType: WorldType;
  // Whether anything in that world can change hands. Follows from worldType, and the server sends
  // it rather than the client deriving it so the rule lives in one place.
  trades: boolean;
  // How many characters the other world holds. What lets a screen say it is narrow rather than
  // empty. See the toggle.
  otherWorldCharacters: number;
  // The character drawn as the account avatar, or null for none. Not narrowed to the active world:
  // the avatar says whose account this is, which the world lens does not change.
  mainCharacterId: string | null;
  // That character's sprite, sent fresh with every read rather than stored anywhere here. See V66.
  mainCharacterSprite: string | null;
};

// PUT /api/settings. Changes which world the site shows. Moves no character: see saveSettings.
export type SaveSettingsBody = {
  worldType: WorldType;
};

// PUT /api/settings/main-character. null clears the choice; a character you do not own is a 404.
export type SaveMainCharacterBody = {
  characterId: string | null;
};
