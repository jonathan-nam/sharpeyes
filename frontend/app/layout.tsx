import type { Metadata } from "next";
import type { ReactNode } from "react";
import { NavPending } from "@/components/nav-pending";
import { SiteHeader } from "@/components/site-header";
import { WebVitals } from "@/components/web-vitals";
import { WorldVeil } from "@/components/world-veil";
import "./globals.css";

export const metadata: Metadata = {
  title: "SharpEyes",
  description: "Your boss tokens, every character, counted in one place.",
};

// Auth resolves in the browser, so the header's signed-in controls cannot be drawn on first paint
// and their arrival shifts the brand sideways (measured: 54px). This reserves their space from what
// was true last time. It only decides whether to HOLD SPACE, never what to show, so a stale value
// costs a reserved gap and cannot leak a signed-in view.
//
// localStorage rather than a cookie, because the session cookie is httpOnly and unreadable here.
// Written by lib/auth-client.ts, which is also where the key lives.
//
// A blocking script rather than a server-side read, because reading cookies in this component opted
// EVERY route into dynamic rendering. Nothing could be prerendered, and dynamic segments get a
// client-router staleTime of 0, so no navigation was ever served from the router cache.
//
// It sits above the header in the body so it runs before the header is parsed, which is what makes
// the reservation a first-paint decision. The class is read by
// `html:not(.has-session) .header-reserved` in globals.css.
const RESERVE_CONTROLS = `try{if(localStorage.getItem("sharpeyes.has-session"))document.documentElement.classList.add("has-session")}catch(e){}`;

// Carries the world-switch veil across the reload the switch does.
//
// WorldToggle raises the veil on click and sets this flag; the reload then throws that DOM away.
// Restoring it here rather than from a React effect is the whole point: an effect runs after the
// first paint, so the new world's page would flash for a frame before being covered, which is the
// flicker the veil exists to remove.
//
// It takes itself down on `load`, and the flag is cleared the moment it is read, so a veil can only
// ever outlive one navigation. The timeout is the backstop for the case that matters more than
// tidiness: `load` never firing would otherwise leave the app behind a veil with no way out.
const WORLD_VEIL = `try{if(sessionStorage.getItem("switching-world")){sessionStorage.removeItem("switching-world");var d=document.documentElement;d.classList.add("switching-world");var off=function(){d.classList.remove("switching-world")};window.addEventListener("load",off,{once:true});setTimeout(off,8000)}}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Dark only: the palette is fixed in :root, so there is no theme to read before paint and
    // nothing to flash. suppressHydrationWarning because the script below adds a class here before
    // React hydrates, which is a difference React would otherwise report.
    <html lang="en" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: RESERVE_CONTROLS }} />
        <script dangerouslySetInnerHTML={{ __html: WORLD_VEIL }} />
        <WebVitals />
        <WorldVeil />
        {/* Above the header so it covers every link on the page, the header's included. */}
        <NavPending />
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
