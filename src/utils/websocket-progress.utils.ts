import { logger } from "./logger";
import { redisClient } from "./redis";

// Import io instance (will be set after server initialization)
let io: any = null;

export function setSocketIOInstance(socketInstance: any) {
  io = socketInstance;
}

export interface GenerationDayStatus {
  dayNumber: number;
  label: string;
  status: "pending" | "generating" | "done" | "failed";
}

export interface ProgressEvent {
  progress: number; // 0-100
  complete?: boolean;
  error?: string;
  // Structured generation status (fan-out weekly generation). Optional so
  // legacy emitProgress events keep the same shape.
  phase?: "planning" | "generating_days" | "saving";
  days?: GenerationDayStatus[];
}

// How long a persisted generation-status snapshot lives in Redis. Generation
// finishes in well under a minute; 10 minutes is a generous safety margin that
// still lets the client recover the timeline after a backgrounded app or a
// dropped socket.
const STATUS_TTL_SECONDS = 600;

export function generationStatusKey(userId: number): string {
  return `generation-status:${userId}`;
}

/**
 * Persist the latest generation status to Redis so the (polled) job-status
 * endpoint can recover the per-day timeline even when the websocket event was
 * never delivered (mobile network drop, app backgrounded, or the Render
 * instance the client's long-poll landed on differs from the worker).
 *
 * Stored as a hash with atomic per-field writes: `progress`/`complete`/`error`
 * update on every event, but `phase`/`days` are only overwritten when the
 * incoming event actually carries them. That way the final bare
 * `{ complete: true }` event keeps the all-days-done timeline intact instead of
 * wiping it.
 */
async function persistGenerationStatus(
  userId: number,
  event: ProgressEvent
): Promise<void> {
  if (!redisClient.isOpen) return;

  const key = generationStatusKey(userId);
  const fields: Record<string, string> = {
    progress: String(event.progress ?? 0),
    complete: event.complete ? "1" : "0",
    updatedAt: new Date().toISOString(),
  };
  if (event.phase !== undefined) fields.phase = event.phase;
  if (event.days !== undefined) fields.days = JSON.stringify(event.days);
  if (event.error !== undefined && event.error !== null) {
    fields.error = event.error;
  }

  await redisClient.hSet(key, fields);
  await redisClient.expire(key, STATUS_TTL_SECONDS);
}

/**
 * Read back the persisted generation status for a user (used by the polled
 * job-status endpoint). Returns null when nothing is stored.
 */
export async function getPersistedGenerationStatus(
  userId: number
): Promise<{ phase?: string; days?: GenerationDayStatus[] } | null> {
  if (!redisClient.isOpen) return null;

  try {
    const data = await redisClient.hGetAll(generationStatusKey(userId));
    if (!data || Object.keys(data).length === 0) return null;

    return {
      phase: data.phase || undefined,
      days: data.days
        ? (JSON.parse(data.days) as GenerationDayStatus[])
        : undefined,
    };
  } catch (error) {
    logger.warn("Failed to read persisted generation status", {
      userId,
      error: (error as Error)?.message,
    });
    return null;
  }
}

/**
 * Emit a structured generation status event (phase + per-day statuses for
 * richer UI). Legacy numeric-only events go through emitProgress below.
 */
export function emitGenerationStatus(userId: number, event: ProgressEvent): void {
  if (io) {
    io.to(`user-${userId}`).emit("workout-progress", event);
  }

  // Persist best-effort so the polled fallback can recover the timeline; never
  // let a Redis hiccup break the (primary) websocket emit above.
  persistGenerationStatus(userId, event).catch((error) => {
    logger.warn("Failed to persist generation status", {
      userId,
      error: (error as Error)?.message,
    });
  });
}

/**
 * Emit progress update to a specific user
 */
export function emitProgress(userId: number, progress: number, complete: boolean = false, error?: string): void {
  emitGenerationStatus(userId, { progress, complete, error });
}
