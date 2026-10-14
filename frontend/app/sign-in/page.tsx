"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AuthField, AuthForm } from "@/components/auth-form";
import { SignInButton } from "@/components/sign-in-button";
import { authClient, PASSWORD_LOGIN } from "@/lib/auth-client";

export default function SignIn() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit() {
    const { error } = await authClient.signIn.email({ email, password });
    if (!error) {
      router.push("/");
      return null;
    }
    // The server answers an unverified account differently from a wrong password, and that is the
    // one distinction worth passing on: it is the difference between "try again" and "go and click
    // the link we sent you". Everything else stays deliberately vague.
    if (error.code === "EMAIL_NOT_VERIFIED") {
      return "Your email isn't confirmed. Check your inbox.";
    }
    return "Wrong email or password. Try again.";
  }

  // Discord alone, and no empty form above it, when passwords are not a way in.
  if (!PASSWORD_LOGIN) {
    return (
      <main className="page">
        <section className="auth-panel">
          <h1>Sign in</h1>
          <SignInButton />
        </section>
      </main>
    );
  }

  return (
    <main className="page">
      <AuthForm
        title="Sign in"
        submitLabel="Sign in"
        onSubmit={submit}
        footer={
          <>
            <Link href="/forgot-password">Forgot your password?</Link>
            {" · "}
            <Link href="/sign-up">Create an account</Link>
          </>
        }
      >
        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <AuthField
          label="Password"
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
      </AuthForm>

      <div className="auth-alt">
        <span className="auth-or">or</span>
        <SignInButton />
      </div>
    </main>
  );
}
