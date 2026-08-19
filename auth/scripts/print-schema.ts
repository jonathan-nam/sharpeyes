/**
 * Prints the DDL Better Auth expects, for the version in package.json.
 *
 * The tables are Flyway's like every other table on this database, so there is one migration story
 * and one nightly dump that restores a working system. This is how their DDL gets written: the
 * library compiles it, we paste the result into a versioned migration, and nobody hand-writes a
 * schema the library will later disagree with.
 *
 *   pnpm run schema        (builds first: this reads the compiled config)
 *
 * Bumping better-auth means running this again and diffing. New output is a new migration, never an
 * edit to an applied one.
 */
import { getMigrations } from "better-auth/db/migration";

import { auth } from "../dist/auth.js";

const { compileMigrations, toBeCreated, unsafeChanges } = await getMigrations(auth.options, {
  throwOnUnsafe: false,
});

// Optional: `unsafeChanges` only exists from 1.7.1. Guarded rather than pinned, so this keeps
// working across the bump it is meant to help with.
if (unsafeChanges && unsafeChanges.length > 0) {
  console.error("refused as unsafe:", unsafeChanges.join("\n"));
  process.exit(1);
}

console.error(`tables: ${toBeCreated.map((t) => t.table).join(", ") || "(none, already present)"}`);
console.log(await compileMigrations());
