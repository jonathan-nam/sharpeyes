"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { spriteUrl } from "@/lib/api";
import { useAccountSettings } from "@/lib/use-account-settings";

// The account button, showing the user's chosen main character instead of the OAuth photo. Clerk
// still owns the actual account actions; this only replaces the avatar and the small menu around
// it (openUserProfile / signOut), so nothing about auth changes. Falls back to the OAuth image
// until a main is picked (star on a character row).
export function UserAvatar() {
  const { user } = useUser();
  const { signOut, openUserProfile } = useClerk();
  const settings = useAccountSettings();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  const sprite = settings?.mainCharacterSprite ?? null;

  return (
    <div className="user-avatar" ref={ref}>
      <button
        type="button"
        className="user-avatar-btn"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {/* A character sprite is full-body pixel art. It is drawn as a background so it can be zoomed
            and positioned to frame the face (see .sprite-face); the OAuth photo is a plain
            image that just fills the circle. */}
        {sprite ? (
          <span
            className="user-avatar-img sprite-face"
            style={{ backgroundImage: `url("${spriteUrl(sprite)}")` }}
            aria-hidden="true"
          />
        ) : (
          <img className="user-avatar-img" src={user.imageUrl} alt="" />
        )}
      </button>

      {open ? (
        <div className="user-avatar-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              openUserProfile();
            }}
          >
            Manage account
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
