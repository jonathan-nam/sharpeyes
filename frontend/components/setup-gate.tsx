"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAccountSettings } from "@/lib/use-account-settings";
import { useAuth } from "@/lib/use-auth";

// Sends an account that has never said which world it plays in to /welcome, from any page. A fresh
// sign-in can land anywhere (a shared party link, a bookmark), and every list there is narrowed by
// a world it does not have yet, so it would only ever draw empty.
//
// Not on the two pages that are the way in: /welcome itself, and an invite, which sets the world as
// it is accepted and then goes on to /welcome.
const EXEMPT = ["/welcome", "/join"];

export function SetupGate() {
  const { isSignedIn } = useAuth();
  const settings = useAccountSettings();
  const pathname = usePathname();
  const router = useRouter();
  const exempt = EXEMPT.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  useEffect(() => {
    if (isSignedIn && settings && settings.worldType === null && !exempt)
      router.replace("/welcome");
  }, [isSignedIn, settings, exempt, router]);

  return null;
}
