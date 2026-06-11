import { logger } from "./logger";

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

/**
 * Emit a structured generation status event (phase + per-day statuses for
 * richer UI). Legacy numeric-only events go through emitProgress below.
 */
export function emitGenerationStatus(userId: number, event: ProgressEvent): void {
  if (!io) {
    return;
  }

  io.to(`user-${userId}`).emit('workout-progress', event);
}

/**
 * Emit progress update to a specific user
 */
export function emitProgress(userId: number, progress: number, complete: boolean = false, error?: string): void {
  emitGenerationStatus(userId, { progress, complete, error });
}