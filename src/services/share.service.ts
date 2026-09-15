import { and, desc, eq, gte, inArray, isNull } from "drizzle-orm";
import { createHmac, randomInt, timingSafeEqual } from "crypto";

import { BaseService } from "@/services/base.service";
import { profileService } from "@/services/profile.service";
import {
  shareLinks,
  planDays,
  workouts,
  workoutBlocks,
  planDayExercises,
  exercises,
  exerciseLogs,
  exerciseSetLogs,
  blockLogs,
  planDayLogs,
  users,
  type ShareKind,
  type ShareNameStyle,
  type ShareSnapshot,
  type ShareSnapshotBlock,
  type ShareSnapshotExercise,
  type ShareSnapshotSet,
  type ShareLink,
} from "@/models";
import { calculateScheduledWorkoutStreak } from "@/utils/streak-calculation.utils";
import { resolveTodayString } from "@/utils/date.utils";
import { logger } from "@/utils/logger";
import {
  blockLabel,
  blockScore,
  isPlausibleDuration,
  SCORED_BLOCK_TYPES,
  summarizePrescription,
  summarizeSets,
  WARMUP_COOLDOWN,
} from "@/utils/share-format";

// ---------------------------------------------------------------------------
// Errors — mapped to HTTP status by the route's handleError (§3.3).
// ---------------------------------------------------------------------------

/** Thrown when a user exceeds the hourly share quota — mapped to 429. */
export class ShareRateLimitError extends Error {
  constructor() {
    super("Too many shares. Please try again later.");
    this.name = "ShareRateLimitError";
  }
}

/** Unknown / unpublished code — mapped to 404 (never leak that it existed). */
export class ShareNotFoundError extends Error {
  constructor() {
    super("Share not found");
    this.name = "ShareNotFoundError";
  }
}

/** A revoked code — mapped to 410 Gone. */
export class ShareRevokedError extends Error {
  constructor() {
    super("This workout is no longer shared");
    this.name = "ShareRevokedError";
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

// Prod default 20/hour per user; override via env for local QA.
const MAX_PER_HOUR = Number(process.env.SHARE_MAX_PER_HOUR) || 20;

const SITE_URL = (process.env.SHARE_SITE_URL || "https://mastersfit.ai").replace(/\/$/, "");

// Shared secret used to sign non-persisted preview tokens; the website verifies
// the same secret before rendering a preview (§3.3 / §4.2). Falls back to the
// JWT secret so a preview still works if the dedicated var isn't set — but set
// SHARE_PREVIEW_SECRET explicitly in both repos for launch.
const PREVIEW_SECRET =
  process.env.SHARE_PREVIEW_SECRET || process.env.JWT_SECRET || "";
const PREVIEW_TTL_MS = 15 * 60 * 1000;

// Crockford base32 without I, L, O, U — reads cleanly aloud and off a card footer.
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

// Small union used to pin the shape of the eager plan-day query result.
type LoadedPlanDay = {
  id: number;
  date: string;
  name: string | null;
  description: string | null;
  isComplete: boolean | null;
  workout: { id: number; userId: number; name: string; description: string | null };
  blocks: Array<{
    id: number;
    order: number | null;
    blockType: string | null;
    blockName: string | null;
    blockDurationMinutes: number | null;
    rounds: number | null;
    timeCapMinutes: number | null;
    exercises: Array<{
      id: number;
      order: number | null;
      sets: number | null;
      reps: number | null;
      repsMin: number | null;
      repsMax: number | null;
      weight: number | null;
      restTime: number | null;
      distanceM: number | null;
      duration: number | null;
      notes: string | null;
      exercise: {
        name: string;
        equipment: string[] | null;
        link: string | null;
        hasDemo: boolean | null;
      };
    }>;
  }>;
};

function base32urlEncode(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function base32urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

// Minimal YouTube id extractor for the landing page's demo links. Mirrors the
// shapes the app's extractYouTubeVideoId handles; returns null when there's no
// playable demo so the row simply renders without a play glyph.
function youTubeId(link: string | null, hasDemo: boolean | null): string | null {
  if (!link || hasDemo === false) return null;
  const m = link.match(
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/
  );
  return m ? m[1] : null;
}

function humanizeEquipment(tag: string): string {
  return tag
    .split(/[_\s-]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}


export class ShareService extends BaseService {
  // -------------------------------------------------------------------------
  // Code generation
  // -------------------------------------------------------------------------
  private generateCode(): string {
    let code = "";
    for (let i = 0; i < 6; i++) code += CROCKFORD[randomInt(CROCKFORD.length)];
    return code;
  }

  private async generateUniqueCode(): Promise<string> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = this.generateCode();
      const existing = await this.selectWithRetry(
        () => this.db.select({ id: shareLinks.id }).from(shareLinks).where(eq(shareLinks.code, code)),
        "shareCodeCollisionCheck"
      );
      if (existing.length === 0) return code;
    }
    throw new Error("Could not generate a unique share code");
  }

  // -------------------------------------------------------------------------
  // Name resolution — the client sends a style, we resolve the label (§3.1).
  // -------------------------------------------------------------------------
  private resolveDisplayName(name: string, style: ShareNameStyle): string | null {
    if (style === "anonymous") return null;
    if (style === "full") return name.trim() || null;
    return name.trim().split(/\s+/)[0] || null; // first token
  }

  // -------------------------------------------------------------------------
  // Snapshot — frozen at share time. NEVER re-resolved by joining live tables
  // on the public read (§3.2).
  // -------------------------------------------------------------------------
  private async loadPlanDay(planDayId: number): Promise<LoadedPlanDay | null> {
    const row = await this.selectWithRetry(
      () =>
        this.db.query.planDays.findFirst({
          where: eq(planDays.id, planDayId),
          with: {
            workout: true,
            blocks: {
              orderBy: [workoutBlocks.order],
              with: {
                exercises: {
                  orderBy: [planDayExercises.order],
                  with: { exercise: true },
                },
              },
            },
          },
        }),
      "loadPlanDayForShare"
    );
    return (row as unknown as LoadedPlanDay) || null;
  }

  /**
   * Pull everything that was actually LOGGED for a plan day, in one pass.
   * Returns empty structures rather than throwing when a day has no logs —
   * a completed day with nothing logged still has to render something.
   */
  private async loadLogs(
    planDayId: number,
    planDayExerciseIds: number[],
    workoutBlockIds: number[]
  ): Promise<{
    setsByPde: Map<number, ShareSnapshotSet[]>;
    loggedPde: Set<number>;
    scoreByBlock: Map<number, string | null>;
    totalTimeSeconds: number | null;
  }> {
    const setsByPde = new Map<number, ShareSnapshotSet[]>();
    const loggedPde = new Set<number>();
    const scoreByBlock = new Map<number, string | null>();

    const [dayLog] = await this.selectWithRetry(
      () =>
        this.db
          .select({ totalTimeSeconds: planDayLogs.totalTimeSeconds })
          .from(planDayLogs)
          .where(eq(planDayLogs.planDayId, planDayId))
          .limit(1),
      "loadPlanDayLogForShare"
    );

    if (planDayExerciseIds.length === 0) {
      return { setsByPde, loggedPde, scoreByBlock, totalTimeSeconds: dayLog?.totalTimeSeconds ?? null };
    }

    const logs = await this.selectWithRetry(
      () =>
        this.db
          .select({
            id: exerciseLogs.id,
            planDayExerciseId: exerciseLogs.planDayExerciseId,
            roundNumber: exerciseLogs.roundNumber,
          })
          .from(exerciseLogs)
          .where(inArray(exerciseLogs.planDayExerciseId, planDayExerciseIds)),
      "loadExerciseLogsForShare"
    );
    for (const l of logs) loggedPde.add(l.planDayExerciseId);

    if (logs.length > 0) {
      const logIds = logs.map((l) => l.id);
      const roundByLog = new Map(logs.map((l) => [l.id, l.roundNumber]));
      const pdeByLog = new Map(logs.map((l) => [l.id, l.planDayExerciseId]));

      const rows = await this.selectWithRetry(
        () =>
          this.db
            .select({
              exerciseLogId: exerciseSetLogs.exerciseLogId,
              setNumber: exerciseSetLogs.setNumber,
              weight: exerciseSetLogs.weight,
              reps: exerciseSetLogs.reps,
              durationSeconds: exerciseSetLogs.durationSeconds,
              distanceM: exerciseSetLogs.distanceM,
            })
            .from(exerciseSetLogs)
            .where(inArray(exerciseSetLogs.exerciseLogId, logIds)),
        "loadSetLogsForShare"
      );

      // Sort by (round, set) so a ramp reads in the order it was performed.
      const decorated = rows
        .map((r) => ({
          ...r,
          round: roundByLog.get(r.exerciseLogId) ?? 1,
          pde: pdeByLog.get(r.exerciseLogId)!,
        }))
        .sort((a, b) => a.round - b.round || a.setNumber - b.setNumber);

      for (const r of decorated) {
        const list = setsByPde.get(r.pde) ?? [];
        list.push({
          reps: r.reps ?? null,
          // decimal comes back as a string from pg; keep it a number.
          weight: r.weight == null ? null : Number(r.weight),
          durationSeconds: r.durationSeconds ?? null,
          distanceM: r.distanceM ?? null,
          round: r.round,
        });
        setsByPde.set(r.pde, list);
      }
    }

    if (workoutBlockIds.length > 0) {
      const bLogs = await this.selectWithRetry(
        () =>
          this.db
            .select({
              workoutBlockId: blockLogs.workoutBlockId,
              score: blockLogs.score,
              roundsCompleted: blockLogs.roundsCompleted,
              totalReps: blockLogs.totalReps,
              actualTimeMinutes: blockLogs.actualTimeMinutes,
            })
            .from(blockLogs)
            .where(inArray(blockLogs.workoutBlockId, workoutBlockIds)),
        "loadBlockLogsForShare"
      );
      for (const b of bLogs) scoreByBlock.set(b.workoutBlockId, blockScore(b));
    }

    return { setsByPde, loggedPde, scoreByBlock, totalTimeSeconds: dayLog?.totalTimeSeconds ?? null };
  }

  private async buildSnapshot(
    userId: number,
    input: {
      planDayId?: number;
      kind: ShareKind;
      showPerformance: boolean;
      showStreak: boolean;
      nameStyle: ShareNameStyle;
    }
  ): Promise<ShareSnapshot> {
    const [user] = await this.selectWithRetry(
      () => this.db.select({ name: users.name }).from(users).where(eq(users.id, userId)),
      "loadUserForShare",
      userId
    );
    if (!user) throw new Error("User not found");
    const displayName = this.resolveDisplayName(user.name, input.nameStyle);

    let streak: number | null = null;
    if (input.showStreak || input.kind === "milestone") {
      streak = await this.computeStreak(userId);
    }

    // Milestone shares carry no plan day.
    if (input.kind === "milestone") {
      return {
        version: 2,
        kind: "milestone",
        workoutName: "Consistency",
        minutesAreActual: false,
        exerciseCount: 0,
        loggedCount: 0,
        setCount: 0,
        partial: false,
        equipment: [],
        blocks: [],
        showPerformance: false,
        streak,
        displayName,
      };
    }

    if (!input.planDayId) throw new Error("planDayId is required for this share kind");
    const pd = await this.loadPlanDay(input.planDayId);
    if (!pd) throw new Error("Plan day not found");
    // Ownership: you can only share your own workout.
    if (pd.workout.userId !== userId) throw new Error("Not authorized to share this workout");

    // Warm-up / cool-down / mobility blocks are dropped from the card, the page
    // AND every count, so the card leads with the working sets and "N exercises"
    // reads honestly. Fall back to all blocks if a plan is *only* warm-up/cool-down,
    // so a share is never empty.
    const isWarmupCooldown = (b: { blockType: string | null; blockName: string | null }) =>
      WARMUP_COOLDOWN.test(`${b.blockType || ""} ${b.blockName || ""}`);
    const working = pd.blocks.filter((b) => !isWarmupCooldown(b));
    const rowBlocks = working.length > 0 ? working : pd.blocks;

    const flat = rowBlocks.flatMap((b) => b.exercises).filter((e) => e && e.exercise);

    // A `planned` share has nothing logged yet, so it reads the prescription;
    // a `completed` share never does.
    const fromLogs = input.kind === "completed";
    const logs = fromLogs
      ? await this.loadLogs(
          pd.id,
          flat.map((e) => e.id),
          rowBlocks.map((b) => b.id)
        )
      : null;

    const blocks: ShareSnapshotBlock[] = rowBlocks.map((b) => {
      const rounds = b.rounds && b.rounds > 1 ? b.rounds : null;
      const scored = SCORED_BLOCK_TYPES.has(b.blockType || "");
      const score = logs?.scoreByBlock.get(b.id) ?? null;

      const exercisesOut: ShareSnapshotExercise[] = b.exercises
        .filter((e) => e && e.exercise)
        .map((e) => {
          const demoVideoId = youTubeId(e.exercise.link, e.exercise.hasDemo);

          if (!fromLogs) {
            return {
              name: e.exercise.name,
              logged: true,
              sets: [],
              summary: summarizePrescription(e),
              note: /each side/i.test(e.notes || "") ? "Each side" : null,
              demoVideoId,
            };
          }

          const hasLog = logs!.loggedPde.has(e.id);
          const sets = logs!.setsByPde.get(e.id) ?? [];

          if (!hasLog) {
            return { name: e.exercise.name, logged: false, sets: [], summary: "Not logged", note: null, demoVideoId };
          }
          if (sets.length === 0) {
            // Logged as done, but no set detail was captured.
            return {
              name: e.exercise.name,
              logged: true,
              sets: [],
              summary: "Completed",
              note: "No set detail",
              demoVideoId,
            };
          }

          const { summary, note } = summarizeSets(sets, rounds ?? 1);
          return {
            name: e.exercise.name,
            logged: true,
            // Performance hidden: keep the row and the shape, drop the numbers.
            sets: input.showPerformance ? sets : [],
            summary: input.showPerformance
              ? summary
              : rounds
                ? `${rounds} rounds`
                : `${sets.length} sets`,
            note: input.showPerformance ? note : null,
            demoVideoId,
          };
        });

      return {
        name: b.blockName,
        type: b.blockType,
        label: blockLabel(b.blockType, rounds, b.blockDurationMinutes, b.timeCapMinutes, scored ? score : null),
        rounds,
        score: scored ? score : null,
        exercises: exercisesOut,
      };
    });

    const allExercises = blocks.flatMap((b) => b.exercises);
    const loggedCount = allExercises.filter((e) => e.logged).length;

    const setCount = fromLogs
      ? [...logs!.setsByPde.values()].reduce((n, list) => n + list.length, 0)
      : flat.reduce((n, e) => n + (e.sets || 0), 0);

    // Real elapsed time when it's believable. The prescribed sum is the LLM's
    // own estimate and runs long — it's a fallback, and the snapshot says which
    // one it is so a reader is never misled about the source.
    const prescribedMinutes =
      pd.blocks.reduce((sum, b) => sum + (b.blockDurationMinutes || 0), 0) || null;
    const actualMinutes = isPlausibleDuration(logs?.totalTimeSeconds ?? null, setCount)
      ? Math.round(logs!.totalTimeSeconds! / 60)
      : null;

    const equipment = Array.from(
      new Set(flat.flatMap((e) => e.exercise.equipment || []).filter(Boolean))
    )
      .slice(0, 4)
      .map(humanizeEquipment);

    return {
      version: 2,
      kind: input.kind,
      workoutName: pd.name || pd.workout.name,
      subtitle: null,
      date: pd.date || null,
      minutes: actualMinutes ?? prescribedMinutes,
      minutesAreActual: actualMinutes != null,
      exerciseCount: allExercises.length,
      loggedCount,
      setCount,
      partial: fromLogs && loggedCount < allExercises.length,
      equipment,
      blocks,
      showPerformance: input.showPerformance,
      streak: input.showStreak ? streak : null,
      displayName,
    };
  }

  private async computeStreak(userId: number): Promise<number> {
    const scheduledDays = await this.selectWithRetry(
      () =>
        this.db
          .select({ date: planDays.date, isComplete: planDays.isComplete })
          .from(planDays)
          .innerJoin(workouts, eq(planDays.workoutId, workouts.id))
          .where(eq(workouts.userId, userId)),
      "loadStreakDaysForShare",
      userId
    );
    if (scheduledDays.length === 0) return 0;
    const profile = await profileService.getProfileByUserId(userId);
    const today = resolveTodayString(profile?.timezone);
    return calculateScheduledWorkoutStreak(
      scheduledDays.map((d) => ({ date: d.date, isComplete: !!d.isComplete })),
      today
    );
  }

  // -------------------------------------------------------------------------
  // Rate limit — rolling hourly window per user (copies the feedback pattern).
  // -------------------------------------------------------------------------
  private async assertUnderRateLimit(userId: number): Promise<void> {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await this.selectWithRetry(
      () =>
        this.db
          .select({ id: shareLinks.id })
          .from(shareLinks)
          .where(and(eq(shareLinks.userId, userId), gte(shareLinks.createdAt, oneHourAgo))),
      "countRecentShares",
      userId
    );
    if (recent.length >= MAX_PER_HOUR) throw new ShareRateLimitError();
  }

  // -------------------------------------------------------------------------
  // Preview token — HMAC-signed, TTL-bounded, embeds the snapshot. Nothing is
  // persisted (§3.3). The website verifies the same secret before rendering.
  // -------------------------------------------------------------------------
  private signPreviewToken(snapshot: ShareSnapshot): string {
    const payload = base32urlEncode(
      Buffer.from(JSON.stringify({ exp: Date.now() + PREVIEW_TTL_MS, snapshot }))
    );
    const sig = base32urlEncode(
      createHmac("sha256", PREVIEW_SECRET).update(payload).digest()
    );
    return `${payload}.${sig}`;
  }

  /** Verify + decode a preview token (used by the public preview path / tests). */
  verifyPreviewToken(token: string): ShareSnapshot | null {
    const [payload, sig] = token.split(".");
    if (!payload || !sig) return null;
    const expected = base32urlEncode(
      createHmac("sha256", PREVIEW_SECRET).update(payload).digest()
    );
    const a = base32urlDecode(sig);
    const b = base32urlDecode(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const decoded = JSON.parse(base32urlDecode(payload).toString());
      if (!decoded?.exp || decoded.exp < Date.now()) return null;
      return decoded.snapshot as ShareSnapshot;
    } catch {
      return null;
    }
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /** POST /api/share/preview — build a snapshot and return a preview URL. Persists nothing. */
  async createPreview(
    userId: number,
    input: {
      planDayId?: number;
      kind: ShareKind;
      showPerformance: boolean;
      showStreak: boolean;
      nameStyle: ShareNameStyle;
    }
  ): Promise<{ previewUrl: string }> {
    await this.assertUnderRateLimit(userId);
    const snapshot = await this.buildSnapshot(userId, input);
    const token = this.signPreviewToken(snapshot);
    return { previewUrl: `${SITE_URL}/w/preview/card.png?t=${token}` };
  }

  /** POST /api/share/workout — mint (or reuse) a published public link. */
  async createShare(
    userId: number,
    input: {
      planDayId?: number;
      kind: ShareKind;
      showPerformance: boolean;
      showStreak: boolean;
      nameStyle: ShareNameStyle;
    }
  ): Promise<{ code: string; url: string; cardUrl: string }> {
    await this.assertUnderRateLimit(userId);

    // Idempotent per (planDayId, kind, showPerformance, showStreak, nameStyle): reuse
    // an existing unrevoked link rather than minting a second code (§3.3).
    const existing = await this.selectWithRetry(
      () =>
        this.db
          .select()
          .from(shareLinks)
          .where(
            and(
              eq(shareLinks.userId, userId),
              input.planDayId != null
                ? eq(shareLinks.planDayId, input.planDayId)
                : isNull(shareLinks.planDayId),
              eq(shareLinks.kind, input.kind),
              eq(shareLinks.showPerformance, input.showPerformance),
              eq(shareLinks.showStreak, input.showStreak),
              eq(shareLinks.nameStyle, input.nameStyle),
              isNull(shareLinks.revokedAt)
            )
          )
          .limit(1),
      "findExistingShare",
      userId
    );
    if (existing[0]) return this.urlsFor(existing[0].code);

    const snapshot = await this.buildSnapshot(userId, input);
    const code = await this.generateUniqueCode();
    await this.insertWithRetry(
      () =>
        this.db.insert(shareLinks).values({
          code,
          userId,
          planDayId: input.planDayId ?? null,
          kind: input.kind,
          showPerformance: input.showPerformance,
          showStreak: input.showStreak,
          nameStyle: input.nameStyle,
          displayName: snapshot.displayName ?? null,
          snapshot,
          publishedAt: new Date(),
        }),
      "insertShareLink",
      userId
    );
    return this.urlsFor(code);
  }

  private urlsFor(code: string) {
    return {
      code,
      url: `${SITE_URL}/w/${code}`,
      cardUrl: `${SITE_URL}/w/${code}/card.png`,
    };
  }

  /**
   * GET /api/share/:code (PUBLIC, no auth). Returns the frozen snapshot only.
   * Increments open_count. Throws ShareNotFoundError (404) for unknown/draft
   * codes and ShareRevokedError (410) for revoked ones. Leaks no PII beyond
   * the resolved displayName inside the snapshot.
   */
  async getPublicByCode(
    code: string
  ): Promise<{ code: string; kind: ShareKind; snapshot: ShareSnapshot; openCount: number }> {
    const normalized = (code || "").toUpperCase();
    const [row] = await this.selectWithRetry(
      () => this.db.select().from(shareLinks).where(eq(shareLinks.code, normalized)).limit(1),
      "getShareByCode"
    );
    if (!row) throw new ShareNotFoundError();
    if (row.revokedAt) throw new ShareRevokedError();
    if (!row.publishedAt) throw new ShareNotFoundError(); // draft — not public yet

    // Best-effort open count; a failure here must not block serving the card.
    void this.updateWithRetry(
      () =>
        this.db
          .update(shareLinks)
          .set({ openCount: row.openCount + 1 })
          .where(eq(shareLinks.id, row.id)),
      "incrementShareOpenCount"
    ).catch((e) => logger.debug("share open_count increment failed", { metadata: { error: String(e) } }));

    return { code: row.code, kind: row.kind, snapshot: row.snapshot, openCount: row.openCount + 1 };
  }

  /** GET /api/share — the caller's links, newest first. */
  async listForUser(userId: number): Promise<
    Array<{
      code: string;
      kind: ShareKind;
      workoutName: string;
      url: string;
      openCount: number;
      revoked: boolean;
      createdAt: Date;
    }>
  > {
    const rows = await this.selectWithRetry(
      () =>
        this.db
          .select()
          .from(shareLinks)
          .where(eq(shareLinks.userId, userId))
          .orderBy(desc(shareLinks.createdAt)),
      "listSharesForUser",
      userId
    );
    return rows.map((r: ShareLink) => ({
      code: r.code,
      kind: r.kind,
      workoutName: r.snapshot?.workoutName ?? "Workout",
      url: `${SITE_URL}/w/${r.code}`,
      openCount: r.openCount,
      revoked: !!r.revokedAt,
      createdAt: r.createdAt,
    }));
  }

  /** DELETE /api/share/:code — owner-only revoke. */
  async revoke(userId: number, code: string): Promise<void> {
    const normalized = (code || "").toUpperCase();
    const [row] = await this.selectWithRetry(
      () => this.db.select().from(shareLinks).where(eq(shareLinks.code, normalized)).limit(1),
      "getShareForRevoke",
      userId
    );
    if (!row || row.userId !== userId) throw new ShareNotFoundError();
    if (row.revokedAt) return; // already revoked — idempotent
    await this.updateWithRetry(
      () =>
        this.db.update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.id, row.id)),
      "revokeShare",
      userId
    );
  }
}

export const shareService = new ShareService();
