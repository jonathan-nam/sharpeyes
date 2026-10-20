// The pages a new account is set up on: /welcome, and an invite, which leads into it. They carry no
// site header and are not redirected to /welcome. See SetupGate and SiteHeader.
const SETUP_PATHS = ["/welcome", "/join"];

export function isSetupPath(pathname: string): boolean {
  return SETUP_PATHS.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}
