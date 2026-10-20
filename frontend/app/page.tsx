"use client";

import Link from "next/link";
import { type ReactNode } from "react";
import { HeroFold } from "@/components/hero-fold";
import { PageMark, SectionMark } from "@/components/section-mark";
import { SharpEyesMark } from "@/components/sharp-eyes-mark";
import { SignInButton } from "@/components/sign-in-button";
import { spriteUrl } from "@/lib/api";
import { homeSections, sectionHref } from "@/lib/drop-sections";
import { HOME_ROWS, type HomeRow } from "@/lib/section-menu";
import { useAccountSettings } from "@/lib/use-account-settings";
import { useAuth } from "@/lib/use-auth";
import { useDeadline, useImageReady } from "@/lib/use-image-ready";

// Past this the hero draws without whatever has not arrived. Long enough to cover a cold settings
// read (the 816ms in lib/use-account-settings.ts) plus the sprite behind it.
const HERO_WAIT_MS = 3000;

export default function Home() {
  const { isSignedIn, isLoaded } = useAuth();
  const settings = useAccountSettings();
  // A Heroic world has only the drops, and then the row is the Drop Log's own.
  const stages = homeSections(settings?.trades);
  // `??` because a tab open across the deploy that added it holds settings without the field.
  const main = settings?.mainCharacterName ?? null;
  const sprite = settings?.mainCharacterSprite ? spriteUrl(settings.mainCharacterSprite) : null;
  const spriteReady = useImageReady(sprite);
  // A failed settings read never answers, so the wait below gives up and draws what it has.
  const waitedEnough = useDeadline(HERO_WAIT_MS);

  // Neither hero until the session is known. Drawing the signed-out one first and swapping it is a
  // returning user being asked to sign in for a frame.
  if (!isLoaded) return <main className="page" />;

  // The signed-in hero in one frame: the name, the fold rows and the sprite all hang off the
  // settings, and the sprite only starts downloading once they arrive, so drawing as each lands
  // painted the page in three steps with the sprite popping in last.
  if (isSignedIn && !waitedEnough && !(settings && spriteReady)) return <main className="page" />;

  // Signed in and never asked which world. Not "welcome back" either: they have not been.
  //
  // Held until the settings arrive for the same reason the hero is held until the session does. The
  // answer decides which of two screens this is, and drawing one and swapping it is the flicker.
  // SetupGate is sending this account to /welcome. Drawn as nothing meanwhile, not as "welcome back".
  if (isSignedIn && settings && settings.worldType === null) return <main className="page" />;

  return (
    <main className="page">
      {isSignedIn ? (
        <section className="hero">
          {/* An empty slot if the wait gave up, so the mark never flashes ahead of the sprite. */}
          {!settings ? (
            <span className="hero-sprite" aria-hidden="true" />
          ) : sprite ? (
            <img className="hero-sprite" src={sprite} alt="" />
          ) : (
            <SharpEyesMark size={64} />
          )}
          {main ? (
            <h1>
              <span className="hero-greeting">Welcome back,</span>{" "}
              <span className="hero-ign">{main}</span>
            </h1>
          ) : (
            <h1>Welcome back</h1>
          )}
          <nav className="hero-actions">
            {HOME_ROWS.map((row) => (
              <HomeRowView key={row.label} row={row}>
                {row.href === "/bosses/drops"
                  ? stages.length > 1 &&
                    stages.map((s) => (
                      <Link key={s.key} href={sectionHref(s.key)}>
                        <SectionMark section={s.key} />
                        {s.label}
                      </Link>
                    ))
                  : row.items.length > 0 &&
                    row.items.map((item) => (
                      <Link key={item.href} href={item.href}>
                        <PageMark href={item.href} />
                        {item.label}
                      </Link>
                    ))}
              </HomeRowView>
            ))}
          </nav>
        </section>
      ) : (
        <section className="hero">
          <SharpEyesMark size={96} />
          <h1>SharpEyes</h1>
          <SignInButton />
        </section>
      )}
    </main>
  );
}

/**
 * One row: a link, or, when it has links to unfold, a toggle for them.
 *
 * A folding row is all toggle even when it has a page of its own (the Drop Log), so every chevron
 * works the same way. Its first unfolded link opens that page.
 */
function HomeRowView({ row, children }: { row: HomeRow; children: ReactNode }) {
  const mark = <PageMark href={row.href ?? row.label} />;

  if (!children) {
    return (
      <Link href={row.href!}>
        {mark}
        {row.label}
      </Link>
    );
  }

  return (
    <HeroFold
      head={
        <>
          {mark}
          {row.label}
        </>
      }
      panelClassName="hero-fold-items"
    >
      {children}
    </HeroFold>
  );
}
