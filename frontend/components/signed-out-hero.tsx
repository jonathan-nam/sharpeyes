import { SharpEyesMark } from "@/components/sharp-eyes-mark";
import { SignInButton } from "@/components/sign-in-button";

/** What somebody signed out sees, on the home page and on Sign In alike. */
export function SignedOutHero() {
  return (
    <section className="hero">
      <SharpEyesMark size={96} />
      <h1>SharpEyes</h1>
      <SignInButton />
    </section>
  );
}
