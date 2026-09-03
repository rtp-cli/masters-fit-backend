import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "@jest/globals";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "@/config/database";
import { users, refreshTokens } from "@/models/user.schema";
import { authCodes } from "@/models/auth.schema";
import { stalledSigninReports } from "@/models/signup-notification.schema";
import { signupNotificationService } from "@/services/signup-notification.service";

/**
 * Integration test for the signup-notification queries. Runs against the LOCAL
 * database (the users.signup_notified_at + users.stalled_digest_notified_at
 * columns must be pushed). Skips cleanly when no DB is reachable so DB-less CI
 * does not fail.
 *
 * The mocked suites cover control flow; this one covers the things only real
 * SQL can prove: that the claim is genuinely atomic under concurrency, and that
 * the stalled query groups, windows, and filters the way the digest assumes.
 */
let dbAvailable = false;
const createdUserIds: number[] = [];
const createdCodeEmails: string[] = [];

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NOW = new Date();

const daysAgo = (n: number) => new Date(NOW.getTime() - n * MS_PER_DAY);
const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 60 * 60 * 1000);

async function makeUser(opts: {
  email: string;
  needsOnboarding?: boolean;
  createdAt: Date;
  isActive?: boolean;
  stalledDigestNotifiedAt?: Date | null;
}): Promise<number> {
  const [row] = await db
    .insert(users)
    .values({
      email: opts.email,
      name: "Test Person",
      needsOnboarding: opts.needsOnboarding ?? true,
      createdAt: opts.createdAt,
      isActive: opts.isActive ?? true,
      stalledDigestNotifiedAt: opts.stalledDigestNotifiedAt ?? null,
    })
    .returning({ id: users.id });

  createdUserIds.push(row.id);
  return row.id;
}

async function giveSession(userId: number, createdAt: Date) {
  await db.insert(refreshTokens).values({
    userId,
    tokenHash: `test-hash-${userId}-${createdAt.getTime()}-${Math.random()}`,
    expiresAt: new Date(NOW.getTime() + 30 * MS_PER_DAY),
    createdAt,
  });
}

async function mailCode(opts: {
  email: string;
  createdAt: Date;
  attempts?: number;
  used?: boolean;
}) {
  createdCodeEmails.push(opts.email);
  await db.insert(authCodes).values({
    email: opts.email,
    // auth_codes.code is globally unique — keep test codes collision-proof.
    code: `T${Math.random().toString(36).slice(2, 10)}${Date.now() % 100000}`,
    expires_at: new Date(opts.createdAt.getTime() + 15 * 60 * 1000),
    created_at: opts.createdAt,
    attempts: opts.attempts ?? 0,
    used: opts.used ?? false,
  });
}

/** Unique per run so parallel/repeat runs never collide on the email unique index. */
const tag = `${Date.now()}-${Math.floor(Math.random() * 10000)}`;
const email = (name: string) => `signup-notify-${tag}-${name}@example.test`;

describe("SignupNotificationService (integration, local DB)", () => {
  beforeAll(async () => {
    try {
      await db.execute(sql`select 1`);
      dbAvailable = true;
    } catch {
      dbAvailable = false;
    }
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    if (createdUserIds.length > 0) {
      await db.delete(refreshTokens).where(inArray(refreshTokens.userId, createdUserIds));
      await db.delete(users).where(inArray(users.id, createdUserIds));
    }
    if (createdCodeEmails.length > 0) {
      await db.delete(authCodes).where(inArray(authCodes.email, createdCodeEmails));
      await db
        .delete(stalledSigninReports)
        .where(
          inArray(
            stalledSigninReports.email,
            createdCodeEmails.map((e) => e.toLowerCase())
          )
        );
    }
  });

  describe("claimNewUserAlert", () => {
    it("is won exactly once, even when two callers race", async () => {
      if (!dbAvailable) return;
      const id = await makeUser({ email: email("race"), createdAt: NOW });

      // Both UPDATEs target the same row with the same IS NULL guard. Postgres
      // serializes them; the loser matches zero rows.
      const [first, second] = await Promise.all([
        signupNotificationService.claimNewUserAlert(id),
        signupNotificationService.claimNewUserAlert(id),
      ]);

      // Exactly one caller gets the claim timestamp; the other gets null.
      expect([first, second].filter((c) => c !== null)).toHaveLength(1);
    });

    it("stays claimed on a later attempt", async () => {
      if (!dbAvailable) return;
      const id = await makeUser({ email: email("twice"), createdAt: NOW });

      expect(await signupNotificationService.claimNewUserAlert(id)).toBeInstanceOf(Date);
      expect(await signupNotificationService.claimNewUserAlert(id)).toBeNull();
    });

    it("can be claimed again after a release, so a failed send retries", async () => {
      if (!dbAvailable) return;
      const id = await makeUser({ email: email("release"), createdAt: NOW });

      const claimedAt = await signupNotificationService.claimNewUserAlert(id);
      await signupNotificationService.releaseNewUserAlert(id, claimedAt!);

      expect(await signupNotificationService.claimNewUserAlert(id)).toBeInstanceOf(Date);
    });

    it("a release with a STALE timestamp cannot clobber a newer claim", async () => {
      if (!dbAvailable) return;
      const id = await makeUser({ email: email("stale-release"), createdAt: NOW });

      // Dispatch A claims, its send stalls; the claim is manually cleared and
      // re-claimed (e.g. the ops script); A's release then arrives late.
      const staleClaim = await signupNotificationService.claimNewUserAlert(id);
      await signupNotificationService.releaseNewUserAlert(id, staleClaim!);
      const freshClaim = await signupNotificationService.claimNewUserAlert(id);
      expect(freshClaim).toBeInstanceOf(Date);

      await signupNotificationService.releaseNewUserAlert(id, staleClaim!);

      // The fresh claim must still stand: a third claim attempt loses.
      expect(await signupNotificationService.claimNewUserAlert(id)).toBeNull();
    });
  });

  describe("getStalledSignupReport", () => {
    let stalledNoSession: number;
    let stalledWithSession: number;

    beforeEach(async () => {
      if (!dbAvailable) return;
      // Clear anything a previous test in this file marked.
      if (createdUserIds.length > 0) {
        await db
          .update(users)
          .set({ stalledDigestNotifiedAt: null })
          .where(inArray(users.id, createdUserIds));
      }
    });

    it("finds stalled users and splits them by whether a session exists", async () => {
      if (!dbAvailable) return;

      stalledNoSession = await makeUser({
        email: email("no-session"),
        createdAt: daysAgo(5),
      });
      stalledWithSession = await makeUser({
        email: email("with-session"),
        createdAt: daysAgo(6),
      });
      await giveSession(stalledWithSession, daysAgo(6));

      const report = await signupNotificationService.getStalledSignupReport(NOW);
      const mine = report.stalled.filter((p) => createdUserIds.includes(p.userId));

      const noSession = mine.find((p) => p.userId === stalledNoSession);
      const withSession = mine.find((p) => p.userId === stalledWithSession);

      expect(noSession?.hasSignedIn).toBe(false);
      expect(noSession?.lastSignInAt).toBeNull();
      expect(withSession?.hasSignedIn).toBe(true);
      expect(withSession?.lastSignInAt).toBeInstanceOf(Date);
    });

    it("reports the MOST RECENT session, not the first", async () => {
      if (!dbAvailable) return;
      const id = await makeUser({ email: email("returning"), createdAt: daysAgo(4) });
      await giveSession(id, daysAgo(4));
      await giveSession(id, daysAgo(1));

      const report = await signupNotificationService.getStalledSignupReport(NOW);
      const person = report.stalled.find((p) => p.userId === id);

      // A returning user must not read as "hasn't been back".
      const hoursSince =
        (NOW.getTime() - (person!.lastSignInAt as Date).getTime()) / (60 * 60 * 1000);
      expect(hoursSince).toBeLessThan(36);
    });

    it("counts one row per user regardless of how many sessions they have", async () => {
      if (!dbAvailable) return;
      const id = await makeUser({ email: email("many-sessions"), createdAt: daysAgo(3) });
      await giveSession(id, daysAgo(3));
      await giveSession(id, daysAgo(2));
      await giveSession(id, daysAgo(1));

      const report = await signupNotificationService.getStalledSignupReport(NOW);

      // Without the GROUP BY this user would appear three times.
      expect(report.stalled.filter((p) => p.userId === id)).toHaveLength(1);
    });

    it("excludes users who finished onboarding", async () => {
      if (!dbAvailable) return;
      const id = await makeUser({
        email: email("finished"),
        createdAt: daysAgo(3),
        needsOnboarding: false,
      });

      const report = await signupNotificationService.getStalledSignupReport(NOW);
      expect(report.stalled.map((p) => p.userId)).not.toContain(id);
    });

    it("excludes signups inside the grace period", async () => {
      if (!dbAvailable) return;
      const id = await makeUser({ email: email("too-fresh"), createdAt: hoursAgo(2) });

      const report = await signupNotificationService.getStalledSignupReport(NOW);
      expect(report.stalled.map((p) => p.userId)).not.toContain(id);
    });

    it("excludes signups older than the tail", async () => {
      if (!dbAvailable) return;
      const id = await makeUser({ email: email("too-old"), createdAt: daysAgo(45) });

      const report = await signupNotificationService.getStalledSignupReport(NOW);
      expect(report.stalled.map((p) => p.userId)).not.toContain(id);
    });

    it("excludes deactivated accounts", async () => {
      if (!dbAvailable) return;
      const id = await makeUser({
        email: email("inactive"),
        createdAt: daysAgo(3),
        isActive: false,
      });

      const report = await signupNotificationService.getStalledSignupReport(NOW);
      expect(report.stalled.map((p) => p.userId)).not.toContain(id);
    });

    it("applies the suppression list inside the query", async () => {
      if (!dbAvailable) return;
      // Uses SIGNUP_NOTIFY_SUPPRESS rather than a real protected account:
      // PROTECTED_EMAILS entries are live rows that must never be created or
      // deleted by a test. This still proves suppression runs in this path.
      const addr = email("suppressed");
      const id = await makeUser({ email: addr, createdAt: daysAgo(3) });

      const previous = process.env.SIGNUP_NOTIFY_SUPPRESS;
      process.env.SIGNUP_NOTIFY_SUPPRESS = addr.toLowerCase();
      try {
        const report = await signupNotificationService.getStalledSignupReport(NOW);
        expect(report.stalled.map((p) => p.userId)).not.toContain(id);
      } finally {
        if (previous === undefined) delete process.env.SIGNUP_NOTIFY_SUPPRESS;
        else process.env.SIGNUP_NOTIFY_SUPPRESS = previous;
      }
    });

    it("does NOT exclude a disposable rtp+<n>@ account", async () => {
      if (!dbAvailable) return;
      // The domain is not the rule — only PROTECTED_EMAILS is. Throwaway test
      // accounts must notify, or the feature cannot be tested on the sim.
      const id = await makeUser({
        email: `rtp+${tag.replace(/\D/g, "").slice(-6)}@mastersfit.ai`,
        createdAt: daysAgo(3),
      });

      const report = await signupNotificationService.getStalledSignupReport(NOW);
      expect(report.stalled.map((p) => p.userId)).toContain(id);
    });

    it("marks arrivals as reported, which empties newlyStalled on the next run", async () => {
      if (!dbAvailable) return;
      const id = await makeUser({ email: email("gate"), createdAt: daysAgo(2) });

      const before = await signupNotificationService.getStalledSignupReport(NOW);
      expect(before.newlyStalled.map((p) => p.userId)).toContain(id);

      await signupNotificationService.markStalledDigestNotified([id], NOW);

      const after = await signupNotificationService.getStalledSignupReport(NOW);
      // Still on the worklist...
      expect(after.stalled.map((p) => p.userId)).toContain(id);
      // ...but no longer a reason to send.
      expect(after.newlyStalled.map((p) => p.userId)).not.toContain(id);
    });

    it("does not re-stamp someone who was already marked", async () => {
      if (!dbAvailable) return;
      const first = new Date(NOW.getTime() - 2 * MS_PER_DAY);
      const id = await makeUser({
        email: email("already-marked"),
        createdAt: daysAgo(4),
        stalledDigestNotifiedAt: first,
      });

      await signupNotificationService.markStalledDigestNotified([id], NOW);

      const [row] = await db
        .select({ at: users.stalledDigestNotifiedAt })
        .from(users)
        .where(eq(users.id, id));

      expect(row.at?.getTime()).toBe(first.getTime());
    });
  });

  describe("getStalledSignupReport — never-finished sign-ins (auth_codes)", () => {
    it("reports an address that was mailed a code and never became an account", async () => {
      if (!dbAvailable) return;
      const addr = email("code-only");
      await mailCode({ email: addr, createdAt: daysAgo(5) });

      const report = await signupNotificationService.getStalledSignupReport(NOW);
      const row = report.stalledSignIns.find((p) => p.email === addr.toLowerCase());

      expect(row).toBeDefined();
      expect(row?.codesSent).toBe(1);
      expect(row?.isNewToDigest).toBe(true);
    });

    it("EXCLUDES an address that did become an account", async () => {
      if (!dbAvailable) return;
      // This is the whole join: a code plus a user row means they got through.
      const addr = email("code-then-account");
      await mailCode({ email: addr, createdAt: daysAgo(5) });
      await makeUser({ email: addr, createdAt: daysAgo(5) });

      const report = await signupNotificationService.getStalledSignupReport(NOW);

      expect(report.stalledSignIns.map((p) => p.email)).not.toContain(
        addr.toLowerCase()
      );
    });

    it("matches the account case-insensitively — nothing lowercases these columns", async () => {
      if (!dbAvailable) return;
      const addr = email("MixedCase");
      await mailCode({ email: addr.toUpperCase(), createdAt: daysAgo(5) });
      await makeUser({ email: addr.toLowerCase(), createdAt: daysAgo(5) });

      const report = await signupNotificationService.getStalledSignupReport(NOW);

      expect(report.stalledSignIns.map((p) => p.email)).not.toContain(
        addr.toLowerCase()
      );
    });

    it("collapses several codes for one address into a single row", async () => {
      if (!dbAvailable) return;
      const addr = email("retried");
      await mailCode({ email: addr, createdAt: daysAgo(4) });
      await mailCode({ email: addr, createdAt: daysAgo(3), attempts: 2 });
      await mailCode({ email: addr, createdAt: daysAgo(2) });

      const report = await signupNotificationService.getStalledSignupReport(NOW);
      const rows = report.stalledSignIns.filter((p) => p.email === addr.toLowerCase());

      expect(rows).toHaveLength(1);
      expect(rows[0].codesSent).toBe(3);
      expect(rows[0].failedAttempts).toBe(2);
      // Stall age runs from the FIRST code, not the latest.
      expect(rows[0].stalledDays).toBeGreaterThanOrEqual(4);
    });

    it("honors the grace period and the tail", async () => {
      if (!dbAvailable) return;
      const fresh = email("code-fresh");
      const old = email("code-old");
      await mailCode({ email: fresh, createdAt: hoursAgo(2) });
      await mailCode({ email: old, createdAt: daysAgo(45) });

      const report = await signupNotificationService.getStalledSignupReport(NOW);
      const emails = report.stalledSignIns.map((p) => p.email);

      expect(emails).not.toContain(fresh.toLowerCase());
      expect(emails).not.toContain(old.toLowerCase());
    });

    it("applies the suppression list to sign-in attempts too", async () => {
      if (!dbAvailable) return;
      const addr = email("code-suppressed");
      await mailCode({ email: addr, createdAt: daysAgo(5) });

      const previous = process.env.SIGNUP_NOTIFY_SUPPRESS;
      process.env.SIGNUP_NOTIFY_SUPPRESS = addr.toLowerCase();
      try {
        const report = await signupNotificationService.getStalledSignupReport(NOW);
        expect(report.stalledSignIns.map((p) => p.email)).not.toContain(
          addr.toLowerCase()
        );
      } finally {
        if (previous === undefined) delete process.env.SIGNUP_NOTIFY_SUPPRESS;
        else process.env.SIGNUP_NOTIFY_SUPPRESS = previous;
      }
    });

    it("stops being new once reported, which closes the gate", async () => {
      if (!dbAvailable) return;
      const addr = email("code-gate");
      await mailCode({ email: addr, createdAt: daysAgo(5) });

      const before = await signupNotificationService.getStalledSignupReport(NOW);
      expect(before.newlyStalledSignIns.map((p) => p.email)).toContain(
        addr.toLowerCase()
      );
      expect(before.hasAnythingNew).toBe(true);

      await signupNotificationService.markStalledSignInsReported(
        [addr.toLowerCase()],
        NOW
      );

      const after = await signupNotificationService.getStalledSignupReport(NOW);
      // Still on the worklist...
      expect(after.stalledSignIns.map((p) => p.email)).toContain(addr.toLowerCase());
      // ...but no longer a reason to send.
      expect(after.newlyStalledSignIns.map((p) => p.email)).not.toContain(
        addr.toLowerCase()
      );
    });

    it("does not become new again when the same address requests another code", async () => {
      if (!dbAvailable) return;
      const addr = email("code-persist");
      await mailCode({ email: addr, createdAt: daysAgo(5) });
      await signupNotificationService.markStalledSignInsReported(
        [addr.toLowerCase()],
        NOW
      );

      // They try again a day later — the ledger is keyed by address, so this
      // must not re-trigger a digest.
      await mailCode({ email: addr, createdAt: daysAgo(1) });

      const report = await signupNotificationService.getStalledSignupReport(NOW);
      expect(report.newlyStalledSignIns.map((p) => p.email)).not.toContain(
        addr.toLowerCase()
      );
    });
  });

  describe("getUnnotifiedCompletedSignups (the missed-alert sweep)", () => {
    it("finds a completed-but-unnotified user inside the 48h window", async () => {
      if (!dbAvailable) return;
      const id = await makeUser({
        email: email("swept"),
        createdAt: hoursAgo(6),
        needsOnboarding: false,
      });

      const ids = await signupNotificationService.getUnnotifiedCompletedSignups(NOW);
      expect(ids).toContain(id);
    });

    it("skips users whose alert already went out", async () => {
      if (!dbAvailable) return;
      const id = await makeUser({
        email: email("swept-done"),
        createdAt: hoursAgo(6),
        needsOnboarding: false,
      });
      await signupNotificationService.claimNewUserAlert(id);

      const ids = await signupNotificationService.getUnnotifiedCompletedSignups(NOW);
      expect(ids).not.toContain(id);
    });

    it("skips users still in onboarding and users outside the window", async () => {
      if (!dbAvailable) return;
      const stillOnboarding = await makeUser({
        email: email("swept-onboarding"),
        createdAt: hoursAgo(6),
        needsOnboarding: true,
      });
      const tooOld = await makeUser({
        email: email("swept-old"),
        createdAt: daysAgo(5),
        needsOnboarding: false,
      });

      const ids = await signupNotificationService.getUnnotifiedCompletedSignups(NOW);
      expect(ids).not.toContain(stillOnboarding);
      expect(ids).not.toContain(tooOld);
    });
  });
});
