"use client";

import Link from "next/link";
import { SharpEyesMark } from "@/components/sharp-eyes-mark";
import { SignInButton } from "@/components/sign-in-button";
import { useAuth } from "@/lib/use-auth";

export default function Home() {
  const { isSignedIn, isLoaded } = useAuth();

  // Neither hero until the session is known. Drawing the signed-out one first and swapping it is a
  // returning user being asked to sign in for a frame.
  if (!isLoaded) return <main className="page" />;

  return (
    <main className="page">
      {isSignedIn ? (
        <section className="hero">
          <SharpEyesMark size={64} />
          <h1>Welcome back</h1>
          <p>
            <Link href="/inventory">See where you stand</Link>, and drop a screenshot on whichever
            character it belongs to.
          </p>
        </section>
      ) : (
        <section className="hero">
          <SharpEyesMark size={96} />
          <h1>A greater view of your whole MapleStory account.</h1>
          <p>
            Farming the same Grandis boss across a stable of mules is normal. Working out how close
            you actually are to a full Eternal set is not, because the game only ever shows you one
            character at a time.
          </p>
          <p>
            Screenshot each character with their inventory open, drop the lot in, and SharpEyes
            reads the counts and adds them up. Every character, in one view.
          </p>
          <SignInButton />
        </section>
      )}
    </main>
  );
}
