/**
 * How many sessions a single date may hold.
 *
 * [LR-069] A date used to hold exactly one. The bonus-workout feature made a
 * second possible — "I did my hour this morning and have 20 minutes tonight" —
 * and nothing bounded it, which is a trap on two axes:
 *
 *  - COST. A bonus workout consumes the DAY_ADJUSTMENT bucket, and a free user
 *    has THREE of those for the lifetime of the account. The button sits on the
 *    completed-workout screen inviting a tap, so three taps in one evening
 *    permanently exhausts their allowance. Paid users are bounded only by the
 *    reasonable-use safeguards, which would allow 40 sessions on one date.
 *  - DISPLAY. The session switcher divides the screen width between sessions.
 *    Two fit comfortably; four are unreadable.
 *
 * Two covers the case this was built for — the planned session plus one
 * addition — and is deliberately conservative. Raise it only with a real use
 * case, and check the switcher still reads at the new number.
 *
 * Env-overridable so the limit can move without a deploy.
 */
export function maxSessionsPerDate(): number {
  const parsed = Number(process.env.MAX_SESSIONS_PER_DATE);
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : 2;
}
