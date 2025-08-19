import { logger } from "./logger";

// Import io instance (will be set after server initialization)
let io: any = null;

export function setSocketIOInstance(socketInstance: any) {
  io = socketInstance;
}

export interface ProgressEvent {
  progress: number; // 0-100
  complete?: boolean;
  error?: string;
}

/**
 * Emit progress update to a specific user
 */
export function emitProgress(userId: number, progress: number, complete: boolean = false, error?: string): void {
  if (!io) {
    return;
  }

  const room = `user-${userId}`;
  const event: ProgressEvent = { progress, complete, error };
  io.to(room).emit('workout-progress', event);
}