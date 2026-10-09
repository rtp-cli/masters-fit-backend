/**
 * Health-import dedupe against the user's own MastersFit sessions.
 *
 * Problem: the watch-nudge banner tells users to start a workout on their
 * watch during a MastersFit session (an app cannot start one remotely). That
 * recording is authored by Apple's Workout app, so its provenance is identical
 * to a dog walk. Its TIME is the giveaway: it exists to cover the MastersFit
 * session, so it overlaps one by construction.
 *
 * Session windows are rebuilt from the timestamps of the sets the user logged,
 * NOT from plan_day_logs.updatedAt — that column is bumped whenever a completed
 * log is edited, so it can sit days after the session. Logged-set timestamps
 * can drift the same way (an edit can add a set later), which is why they are
 * split into clusters rather than spanned min→max: one late edit must not grow
 * a window across days and swallow every walk in between.
 */

export interface SessionWindow {
  start: number; // epoch ms
  end: number; // epoch ms
}

/**
 * Two logged sets further apart than this are separate sittings. Generous on
 * purpose: one long cardio exercise inside a session (a 45-minute walk or
 * bike) leaves a gap that size between sets. Late edits land hours or days
 * later, well past it.
 */
export const SESSION_GAP_MS = 90 * 60 * 1000;

/**
 * Slack added to both ends of a window. A watch is usually started a few
 * minutes before the first set is logged and stopped a few after the last.
 */
export const SESSION_PAD_MS = 15 * 60 * 1000;

/**
 * Collapse the logged-set timestamps of ONE plan day into padded windows.
 * Plan days must be clustered separately — two different sessions an hour
 * apart are never one sitting.
 */
export function clusterSessionWindows(timestamps: number[]): SessionWindow[] {
  const sorted = [...timestamps].sort((a, b) => a - b);
  const windows: SessionWindow[] = [];

  for (const t of sorted) {
    const last = windows[windows.length - 1];
    if (last && t - last.end <= SESSION_GAP_MS) {
      last.end = t;
    } else {
      windows.push({ start: t, end: t });
    }
  }

  return windows.map((w) => ({
    start: w.start - SESSION_PAD_MS,
    end: w.end + SESSION_PAD_MS,
  }));
}

/** True when [start, end] touches any session window. */
export function overlapsAnySession(
  start: number,
  end: number,
  windows: SessionWindow[]
): boolean {
  return windows.some((w) => start <= w.end && end >= w.start);
}
