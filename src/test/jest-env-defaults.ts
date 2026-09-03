/**
 * Test-only environment defaults. Registered as jest `setupFiles`, so this runs
 * before each test file's imports — early enough for modules that read
 * process.env at load time.
 *
 * Why this exists: the unit suites had been quietly running off whatever was in
 * the developer's `.env`. Two modules read env at import time —
 * `@/config/database` throws unless DATABASE_URL is set (and
 * jest-setup-after-env.ts imports it to close the pool), and anything signing a
 * JWT needs JWT_SECRET. With a local .env present that was invisible; in CI,
 * where there is no .env, all 28 suites died before running a line.
 *
 * Setting defaults here rather than in the workflow keeps CI and a clean
 * checkout behaving identically, and means a new env dependency shows up as a
 * failure to fix in one place instead of a workflow to patch.
 *
 * These are deliberately inert placeholders, never real credentials:
 *  - DATABASE_URL points at a port nothing listens on. pg.Pool connects lazily,
 *    so hermetic suites never touch it — and a test that quietly reaches a real
 *    database fails loudly instead of passing off ambient dev data.
 *  - JWT_SECRET is a fixed dummy. Tests assert that a token was minted and that
 *    round-trips verify, never a particular signature.
 *
 * Anything already set in the environment wins, so a developer with a real .env
 * (or a CI job that needs to override one) is unaffected.
 */

import dotenv from "dotenv";

// Load .env FIRST, then fill only what's still missing. Order matters: dotenv
// never overwrites an already-set variable, so seeding defaults before this
// would shadow a developer's real DATABASE_URL with the dead placeholder below
// and break the integration suites that legitimately want the local database.
// In CI there is no .env, this is a no-op, and the defaults apply.
dotenv.config();

const defaults: Record<string, string> = {
  DATABASE_URL: "postgresql://ci:ci@127.0.0.1:5433/unused_in_tests",
  JWT_SECRET: "test-only-jwt-secret-not-a-real-credential",
  NODE_ENV: "test",
  // email.service constructs `new Resend(key)` at module LOAD, and Resend's
  // constructor throws on a missing key — so any suite that (transitively)
  // imports the real email.service dies in CI without this. The value is an
  // inert placeholder: no test sends mail (suites that exercise sending mock
  // emailService), it only has to exist.
  RESEND_API_KEY: "re_test_only_not_a_real_key",
};

for (const [key, value] of Object.entries(defaults)) {
  if (!process.env[key]) {
    process.env[key] = value;
  }
}
