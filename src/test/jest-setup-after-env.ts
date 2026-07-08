/**
 * Runs after the test framework is installed, once per test file — this is
 * where global afterAll/beforeAll hooks can register.
 *
 * database.ts opens a real pg.Pool as a load-time side effect of being
 * imported (used by BaseService, which most services extend), and nothing
 * ever closes it in tests. That's why "npm test" reliably logs "Jest did not
 * exit one second after the test run has completed" — not a hang, just a
 * dangling connection keeping the process alive until Jest's own timeout.
 * Closing it here fixes that for every test file without changing any
 * production connection behavior.
 */
import { afterAll } from "@jest/globals";
import { pool } from "@/config/database";

afterAll(async () => {
  await pool.end();
});
