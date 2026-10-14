"use client";

import Link from "next/link";
import { redirect } from "next/navigation";
import { useState } from "react";
import { AuthField, AuthForm } from "@/components/auth-form";
import { authClient, PASSWORD_LOGIN } from "@/lib/auth-client";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");

  // Reachable by URL even with nothing linking here, so it answers for itself rather than
  // rendering a form the server would refuse.
  if (!PASSWORD_LOGIN) redirect("/");

  async function submit() {
    const { error } = await authClient.requestPasswordReset({
      email,
      redirectTo: `${window.location.origin}/reset-password`,
    });
    return error ? "Couldn't send that. Try again." : null;
  }

  return (
    <main className="page">
      <AuthForm
        title="Reset your password"
        submitLabel="Send a reset link"
        onSubmit={submit}
        // Says nothing about whether the address is registered, because the server does not either.
        done="If that address has an account, a reset link is on its way."
        footer={<Link href="/sign-in">Back to sign in</Link>}
      >
        <AuthField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="email"
        />
      </AuthForm>
    </main>
  );
}
