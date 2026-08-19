/**
 * Config, read once and refused loudly.
 *
 * Same rule as the backend's Env.kt and the compose file's `:?` defaults: a service that boots
 * happily on a placeholder and then fails every request is worse than one that will not start. It
 * has already cost debugging time twice on the JWKS URL alone.
 */

export function env(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. See auth/README.md for what it should be.`);
  }
  return value;
}

export function optionalEnv(name: string): string | undefined {
  return process.env[name] || undefined;
}
