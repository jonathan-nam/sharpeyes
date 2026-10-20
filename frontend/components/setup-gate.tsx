"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAccountSettings } from "@/lib/use-account-settings";
import { isSetupPath } from "@/lib/setup-paths";
import { useAuth } from "@/lib/use-auth";

// Sends an account that has never said which world it plays in to /welcome, from any page. A fresh
// sign-in can land anywhere (a shared party link, a bookmark), and every list there is narrowed by
// a world it does not have yet, so it would only ever draw empty.
//
// Not on the pages that are the way in: see isSetupPath.

export function SetupGate() {
  const { isSignedIn } = useAuth();
  const settings = useAccountSettings();
  const pathname = usePathname();
  const router = useRouter();
  const exempt = isSetupPath(pathname);

  useEffect(() => {
    if (isSignedIn && settings && settings.worldType === null && !exempt)
      router.replace("/welcome");
  }, [isSignedIn, settings, exempt, router]);

  return null;
}
