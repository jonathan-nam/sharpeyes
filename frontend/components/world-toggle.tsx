"use client";

import { useAuth } from "@/lib/use-auth";
import { useState } from "react";
import { apiFetch } from "@/lib/api";
import { setAccountSettings, SETTINGS_KEY, useAccountSettings } from "@/lib/use-account-settings";
import { WORLD_TYPES, worldShortLabel, type WorldType } from "@/lib/world";
import type { Settings } from "@/types/settings";

// Which world the site is answering for.
//
// In the header rather than on a settings page, because it is not a preference you set once. It
// says what every number on screen is a number of, so it belongs where the numbers are.

/**
 * The class and the flag, set together.
 *
 * The class covers the page now; the flag is what the RootLayout script reads to put the veil back
 * up on the far side of the reload. Setting one without the other is a veil that vanishes at the
 * navigation or one that never appears until it, which are the two halves of the flicker.
 *
 * Both are best-effort: sessionStorage throws in some privacy modes, and a world that switches
 * without the veil is worse-looking, not wrong.
 */
function raiseVeil() {
  document.documentElement.classList.add("switching-world");
  try {
    sessionStorage.setItem("switching-world", "1");
  } catch {
    // Nothing to do. The veil still covers this side of the reload.
  }
}

function lowerVeil() {
  document.documentElement.classList.remove("switching-world");
  try {
    sessionStorage.removeItem("switching-world");
  } catch {
    // Nothing stored, so nothing to clear.
  }
}

export function WorldToggle() {
  const settings = useAccountSettings();
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);

  // Nothing to draw until the answer arrives. A default drawn here would be a claim about which
  // world you are in, made before anyone asked, and half of them would be wrong.
  if (!settings) return null;

  async function choose(world: WorldType) {
    if (busy || world === settings?.worldType) return;
    setBusy(true);
    // Before the request, not after it. The save is a round trip and the reload is another, and
    // with nothing on screen for either the click reads as having done nothing at all.
    raiseVeil();
    try {
      const saved = await apiFetch<Settings>(
        SETTINGS_KEY,
        { method: "PUT", body: JSON.stringify({ worldType: world }) },
        getToken,
      );
      setAccountSettings(saved);
      // A reload, not a cache invalidation. Every list, count and total on screen was narrowed to
      // the old world by the server, and pages here fetch once on mount: clearing the cache would
      // leave the mounted page showing the other world's data with the toggle saying otherwise.
      // That is the exact failure this app exists to prevent, so the blunt instrument wins.
      //
      // The veil is what makes it a transition rather than a glitch. It survives the reload through
      // sessionStorage, read back before first paint by the script in RootLayout.
      window.location.reload();
    } catch {
      // Left as it was, veil included: nothing changed, so nothing should be covering it. The
      // toggle is one click to retry, and an error line in the header would outlive the moment it
      // belongs to.
      lowerVeil();
      setBusy(false);
    }
  }

  return (
    <span className="world-toggle" role="group" aria-label="World">
      {WORLD_TYPES.map((option) => (
        <button
          key={option}
          type="button"
          className={settings.worldType === option ? "world-tab active" : "world-tab"}
          aria-pressed={settings.worldType === option}
          disabled={busy}
          onClick={() => choose(option)}
        >
          {worldShortLabel(option)}
        </button>
      ))}
    </span>
  );
}
