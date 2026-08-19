"use client";

import Link from "next/link";
import { SectionMenu } from "@/components/section-menu";
import { UserAvatar } from "@/components/user-avatar";
import { WorldToggle } from "@/components/world-toggle";
import { useAuth } from "@/lib/use-auth";
import { SharpEyesMark } from "./sharp-eyes-mark";

// Every page used to restate the app's name in its own <h1> and link to the others
// by hand. One header instead, with the Sharp Eyes mark.
//
// The .header-reserved boxes hold the signed-in controls' space until the session resolves, so the
// real control fades into space that was already there rather than shifting the brand. They are
// always rendered; CSS decides whether they take space, keyed off the class the inline script in
// RootLayout sets before first paint. That was a `reserveControls` prop from a cookies() read,
// which cost the whole app static rendering.
export function SiteHeader() {
  const { isSignedIn, isLoaded } = useAuth();

  return (
    <header className="site-header">
      {/* The bar is full-bleed, the inner wrapper carries the shared column, so the brand lines up
          with the page content underneath it. */}
      <div className="site-header-inner">
        <Link href="/" className="brand">
          {/* 32, not 28: the sprite is 32x32 and drawn with image-rendering pixelated, so a
              non-multiple size drops whole rows and columns, and which ones it drops shifts with
              zoom and display scaling. At 28 the mark visibly alternated between two shapes. */}
          <SharpEyesMark size={32} />
          <span className="brand-name">SharpEyes</span>
        </Link>

        {/* Sections open from a hamburger just right of the brand. Signed-in only: they are
            account views. */}
        {!isLoaded && (
          <div className="section-menu header-reserved" aria-hidden="true">
            <div className="section-menu-btn is-reserved">
              <span className="section-menu-icon" />
            </div>
          </div>
        )}
        {isSignedIn && <SectionMenu />}

        {/* Which world everything below is answering for. Beside the sections rather than by the
            avatar: it scopes what the menu leads to, not who you are signed in as. */}
        {isSignedIn && <WorldToggle />}

        {!isLoaded && (
          <div className="site-user header-reserved" aria-hidden="true">
            <div className="user-avatar">
              <div className="user-avatar-btn is-reserved" />
            </div>
          </div>
        )}
        {isSignedIn && (
          <div className="site-user">
            <UserAvatar />
          </div>
        )}
      </div>
    </header>
  );
}
