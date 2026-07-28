import { and, desc, eq, gte, isNull } from "drizzle-orm";
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
  users,
  type ShareKind,
  type ShareNameStyle,
  type ShareSnapshot,
  type ShareSnapshotExercise,
  type ShareLink,
} from "@/models";
import { calculateScheduledWorkoutStreak } from "@/utils/streak-calculation.utils";
import { resolveTodayString } from "@/utils/date.utils";
import { logger } from "@/utils/logger";

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
    order: number | null;
    blockType: string | null;
    blockName: string | null;
    blockDurationMinutes: number | null;
    exercises: Array<{
      order: number | null;
      sets: number | null;
      reps: number | null;
      repsMin: number | null;
      repsMax: number | null;
      weight: number | null;
      restTime: number | null;
      distanceM: number | null;
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

  private async buildSnapshot(
    userId: number,
    input: {
      planDayId?: number;
      kind: ShareKind;
      showWeights: boolean;
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
        kind: "milestone",
        workoutName: "Consistency",
        exerciseCount: 0,
        setCount: 0,
        equipment: [],
        exercises: [],
        streak,
        displayName,
      };
    }

    if (!input.planDayId) throw new Error("planDayId is required for this share kind");
    const pd = await this.loadPlanDay(input.planDayId);
    if (!pd) throw new Error("Plan day not found");
    // Ownership: you can only share your own workout.
    if (pd.workout.userId !== userId) throw new Error("Not authorized to share this workout");

    // `planned` never carries the sharer's weights (§4.2); `completed` carries
    // them only when the sharer opted in. When off, weight is OMITTED, not
    // included-and-hidden (§3.2).
    const includeWeights = input.kind === "completed" && input.showWeights;

    // Warmup/cooldown/mobility blocks are dropped from the card's rows AND its
    // exercise/set counts so the card leads with the working sets and the
    // "N exercises · N sets" reads honestly. Minutes stays the full session
    // (wall-clock time is time). Fall back to all blocks if a plan is *only*
    // warmup/cooldown, so a card is never empty.
    const isWarmupCooldown = (b: { blockType: string | null; blockName: string | null }) =>
      /warm|cool|mobility|stretch|activation|prehab/i.test(
        `${b.blockType || ""} ${b.blockName || ""}`
      );
    const workingBlocks = pd.blocks.filter((b) => !isWarmupCooldown(b));
    const rowBlocks = workingBlocks.length > 0 ? workingBlocks : pd.blocks;

    const flat = rowBlocks
      .flatMap((b) => b.exercises)
      .filter((e) => e && e.exercise);

    const exerciseRows: ShareSnapshotExercise[] = flat.map((e) => {
      const row: ShareSnapshotExercise = {
        name: e.exercise.name,
        sets: e.sets,
        reps: e.reps,
        repsMin: e.repsMin ?? undefined,
        repsMax: e.repsMax ?? undefined,
        restSeconds: e.restTime ?? undefined,
        distanceM: e.distanceM ?? undefined,
        eachSide: /each side/i.test(e.notes || "") || undefined,
        demoVideoId: youTubeId(e.exercise.link, e.exercise.hasDemo),
      };
      if (includeWeights && e.weight != null) row.weight = e.weight;
      return row;
    });

    const minutes =
      pd.blocks.reduce((sum, b) => sum + (b.blockDurationMinutes || 0), 0) || null;
    const setCount = flat.reduce((sum, e) => sum + (e.sets || 0), 0);

    const equipment = Array.from(
      new Set(flat.flatMap((e) => e.exercise.equipment || []).filter(Boolean))
    )
      .slice(0, 4)
      .map(humanizeEquipment);

    return {
      kind: input.kind,
      workoutName: pd.name || pd.workout.name,
      subtitle: null,
      date: pd.date || null,
      minutes,
      exerciseCount: exerciseRows.length,
      setCount,
      equipment,
      exercises: exerciseRows,
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
      showWeights: boolean;
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
      showWeights: boolean;
      showStreak: boolean;
      nameStyle: ShareNameStyle;
    }
  ): Promise<{ code: string; url: string; cardUrl: string }> {
    await this.assertUnderRateLimit(userId);

    // Idempotent per (planDayId, kind, showWeights, showStreak, nameStyle): reuse
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
              eq(shareLinks.showWeights, input.showWeights),
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
          showWeights: input.showWeights,
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
