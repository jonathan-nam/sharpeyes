"use client";

import Link from "next/link";
import { redirect } from "next/navigation";
import { useState } from "react";
import { AuthField, AuthForm } from "@/components/auth-form";
import { authClient, PASSWORD_LOGIN } from "@/lib/auth-client";

// Matches the auth service's minPasswordLength. Stated on the field rather than only enforced,
// because a rejected password after submitting is a rule you were not told.
const MIN_PASSWORD = 12;

export default function SignUp() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Reachable by URL even with nothing linking here, so it answers for itself rather than
  // rendering a form the server would refuse.
  if (!PASSWORD_LOGIN) redirect("/");

  async function submit() {
    if (password.length < MIN_PASSWORD)
      return `Password too short. Use ${MIN_PASSWORD} or more characters.`;
    const { error } = await authClient.signUp.email({ name, email, password });
    // Deliberately not distinguishing "already registered": the server does not either, so that a
    // stranger cannot use this form to find out who has an account here.
    return error ? "Couldn't create that account. Try again." : null;
  }

  return (
    <main className="page">
      <AuthForm
        title="Create an Account"
        submitLabel="Create Account"
        onSubmit={submit}
        done="Check your email to confirm your address."
        footer={<Link href="/sign-in">Already Have One? Sign In</Link>}
      >
        <AuthField label="Name" type="text" value={name} onChange={setName} autoComplete="name" />
        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
        <AuthField
          label={`Password (${MIN_PASSWORD}+ characters)`}
          type="password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
        />
      </AuthForm>
    </main>
  );
}
