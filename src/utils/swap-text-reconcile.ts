/**
 * Keeping a day's prose in step with its exercises after a manual swap.
 *
 * Swapping an exercise only rewrites the `plan_day_exercises` row, so a day
 * named "Strength — Barbell Back Squat + Metcon" kept that name (and its
 * squat cues) after the user swapped in Deadlift. The generator prompts ban
 * exercise names in day/block prose, but the model doesn't always obey, and
 * "repeat a workout" copies prose written before those rules existed.
 *
 * Two passes, both best-effort (a swap must never fail because of its prose):
 *   1. deterministic — replace the old exercise's exact name with the new one
 *      (synchronous, so the headline names are right on the next refresh);
 *   2. LLM rewrite — catches the paraphrases pass 1 can't ("back squat
 *      strength work", "the squat progression"), run in the background and
 *      only when a key word of the old name is still in the text.
 *
 * Everything in this file is pure; the DB + LLM wiring lives in
 * swap-text-reconcile.service.ts.
 */

/** The prose fields a swap can leave stale: the day's three and the block's two. */
export interface SwapProse {
  dayName: string | null;
  dayDescription: string | null;
  dayInstructions: string | null;
  blockName: string | null;
  blockInstructions: string | null;
}

export const SWAP_PROSE_FIELDS: (keyof SwapProse)[] = [
  "dayName",
  "dayDescription",
  "dayInstructions",
  "blockName",
  "blockInstructions",
];

// Words in an exercise name that say HOW it's loaded or positioned, not WHAT
// the movement is. "Barbell Back Squat" → key word "squat"; matching
// "barbell" or "back" would fire the rewrite on every barbell or back day.
const NON_MOVEMENT_WORDS = new Set([
  "barbell", "dumbbell", "dumbbells", "kettlebell", "kettlebells", "cable",
  "machine", "band", "banded", "bodyweight", "weighted", "smith", "trap",
  "single", "double", "alternating", "standing", "seated", "with", "and",
  "the", "from", "plus", "light", "heavy", "back", "front", "side", "high",
  "low", "wide", "narrow", "close", "grip", "incline", "decline", "flat",
]);

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Word boundaries that also work next to punctuation — `\b` never matches
// after the ")" in "Push-Up (Knees)".
const NOT_AFTER_WORD = "(?<![A-Za-z0-9])";
const NOT_BEFORE_WORD = "(?![A-Za-z0-9])";

/**
 * Pass 1: replace every case-insensitive, whole-phrase occurrence of `oldName`
 * with `newName`. A trailing plural "s" on the match is absorbed so
 * "Barbell Back Squats" doesn't become "Deadlifts" — the new name is used
 * exactly as the catalog spells it.
 */
export function replaceExerciseName(
  text: string | null,
  oldName: string,
  newName: string
): string | null {
  if (!text || !oldName.trim()) return text;
  const pattern = new RegExp(
    `${NOT_AFTER_WORD}${escapeRegExp(oldName.trim())}(?:e?s)?${NOT_BEFORE_WORD}`,
    "gi"
  );
  return text.replace(pattern, newName);
}

export function replaceInProse(prose: SwapProse, oldName: string, newName: string): SwapProse {
  const out = { ...prose };
  for (const field of SWAP_PROSE_FIELDS) {
    out[field] = replaceExerciseName(prose[field], oldName, newName);
  }
  return out;
}

/** The movement words of an exercise name, e.g. "Barbell Back Squat" → ["squat"]. */
export function movementKeywords(exerciseName: string): string[] {
  return exerciseName
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length >= 4 && !NON_MOVEMENT_WORDS.has(w));
}

/**
 * Gate for pass 2: does any prose field still mention the old movement? Prefix
 * match, so "squat" catches "squats" and "squatting". Most swaps answer no
 * (the prompts keep exercise names out of prose), and those skip the LLM call.
 */
export function proseMentionsMovement(prose: SwapProse, oldName: string, newName: string): boolean {
  // A key word the new exercise shares (Back Squat → Front Squat) is still
  // accurate prose, so it doesn't count as stale.
  const newWords = new Set(movementKeywords(newName));
  const words = movementKeywords(oldName).filter((w) => !newWords.has(w));
  if (words.length === 0) return false;
  const pattern = new RegExp(`\\b(?:${words.map(escapeRegExp).join("|")})`, "i");
  return SWAP_PROSE_FIELDS.some((f) => {
    const text = prose[f];
    return !!text && pattern.test(text);
  });
}

/**
 * Accept the model's rewrite field by field, falling back to the current text
 * for any field that looks wrong: missing, emptied, ballooned, or still naming
 * the old exercise outright. A field that was null stays null.
 */
export function acceptRewrite(
  current: SwapProse,
  proposed: Partial<Record<keyof SwapProse, unknown>>,
  oldName: string
): SwapProse {
  const oldNamePattern = new RegExp(`${NOT_AFTER_WORD}${escapeRegExp(oldName.trim())}`, "i");
  const out = { ...current };
  for (const field of SWAP_PROSE_FIELDS) {
    const before = current[field];
    const after = proposed[field];
    if (!before || typeof after !== "string") continue;
    const trimmed = after.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.length > before.length * 2 + 200) continue;
    if (oldNamePattern.test(trimmed)) continue;
    out[field] = trimmed;
  }
  return out;
}

export function proseChanged(a: SwapProse, b: SwapProse): boolean {
  return SWAP_PROSE_FIELDS.some((f) => a[f] !== b[f]);
}

export const SWAP_REWRITE_SYSTEM_PROMPT = `You edit the text of one workout day in a fitness app after the user swapped one exercise for another.

Rewrite ONLY the parts of each field that refer to the old exercise so they fit the new exercise instead: its name, paraphrases of it ("the squat progression", "back squat strength work"), and coaching cues specific to it (e.g. knee tracking for a squat becomes hip hinge / neutral spine for a deadlift).

Rules:
- Leave everything else word-for-word: other exercises, the metcon or other blocks, rest times, RPE, safety and health notes that still apply, tone, and length.
- If a field never refers to the old exercise, return it unchanged.
- Do not invent weights, reps, or sets. If the old text gives a load that was specific to the old exercise, drop the number rather than guess one.
- Do not add exercises, blocks, or new advice.
- Keep each name short, in the same style as the original.`;

export function buildSwapRewriteUserMessage(
  prose: SwapProse,
  oldName: string,
  newName: string
): string {
  const fields = SWAP_PROSE_FIELDS.filter((f) => prose[f]).map(
    (f) => `${f}: ${JSON.stringify(prose[f])}`
  );
  return [
    `Old exercise: ${JSON.stringify(oldName)}`,
    `New exercise: ${JSON.stringify(newName)}`,
    "",
    "Current text (return every field listed, rewritten or unchanged):",
    ...fields,
  ].join("\n");
}

/** Structured-output schema for the rewrite call: same five fields, all strings. */
export const SWAP_REWRITE_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(
    SWAP_PROSE_FIELDS.map((f) => [f, { type: "string" }])
  ),
  required: [],
  additionalProperties: false,
} as const;
