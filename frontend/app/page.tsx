"use client";

import Link from "next/link";
import { SharpEyesMark } from "@/components/sharp-eyes-mark";
import { SignInButton } from "@/components/sign-in-button";
import { WorldChoice } from "@/components/world-choice";
import { PASSWORD_LOGIN } from "@/lib/auth-client";
import { HOME_ACTIONS } from "@/lib/section-menu";
import { useAccountSettings } from "@/lib/use-account-settings";
import { useAuth } from "@/lib/use-auth";

export default function Home() {
  const { isSignedIn, isLoaded } = useAuth();
  const settings = useAccountSettings();

  // Neither hero until the session is known. Drawing the signed-out one first and swapping it is a
  // returning user being asked to sign in for a frame.
  if (!isLoaded) return <main className="page" />;

  // Signed in and never asked which world. Not "welcome back" either: they have not been.
  //
  // Held until the settings arrive for the same reason the hero is held until the session does. The
  // answer decides which of two screens this is, and drawing one and swapping it is the flicker.
  if (isSignedIn && settings && settings.worldType === null) {
    return (
      <main className="page">
        <WorldChoice />
      </main>
    );
  }

  return (
    <main className="page">
      {isSignedIn ? (
        <section className="hero">
          <SharpEyesMark size={64} />
          <h1>Welcome back</h1>
          <nav className="hero-actions">
            {HOME_ACTIONS.map((item) => (
              <Link key={item.href} href={item.href}>
                {item.label}
              </Link>
            ))}
          </nav>
        </section>
      ) : (
        <section className="hero">
          <SharpEyesMark size={96} />
          <h1>A greater view of your whole MapleStory account.</h1>
          <SignInButton />
          {PASSWORD_LOGIN ? (
            <p className="hero-alt">
              <Link href="/sign-in">or use an email and password</Link>
            </p>
          ) : null}
        </section>
      )}
    </main>
  );
}
