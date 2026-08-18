/**
 * Runtime guard against medical / absolute-safety / guaranteed-outcome claims in
 * LLM-generated, USER-VISIBLE plan text (plan name + description, day name/focus,
 * block descriptions, exercise notes, feedback-conflict messages).
 *
 * Why a code guard and not just the prompt: the model reliably reaches for
 * "shoulder-safe", "knee-safe", "pain-free" etc. for limitation profiles, and a
 * strengthened prompt reduces but does not eliminate it. MastersFit is a fitness
 * app, not a medical device — it must never characterize a plan/exercise as
 * medically safe, injury-proof, or guaranteed for a condition.
 *
 * Design: DETERMINISTIC SANITIZE (heal), not throw-and-retry. This mirrors the
 * post-generation "scalars heal" philosophy (capExerciseRepetition et al.):
 * safety wording is a content issue, and retrying the LLM on wording is
 * unreliable and would fail user generations. Sanitizing GUARANTEES clean output
 * every time. `detectSafetyClaims` remains available for telemetry, tests, and a
 * hard post-sanitize assertion.
 *
 * Neutral replacements follow the product's control-oriented positioning: the
 * plan is adapted around the user's REPORTED history/limitations — it does not
 * treat, rehabilitate, clear, or protect.
 */

// User-visible string fields the model produces. Anything not in this set (enum
// values, muscle-group tokens, ids) is left untouched.
export const USER_VISIBLE_TEXT_KEYS = new Set([
  "name",
  "description",
  "focus",
  "notes",
  "note",
  "summary",
  "title",
  "request",
  "reason",
  "label",
]);

// Ordered: compound/hyphenated forms MUST run before the bare `safe` rule, or
// "shoulder-safe" would become "shoulder-suitable" instead of "lower-impact".
const REPLACEMENTS: Array<[RegExp, string]> = [
  // "<joint>-safe" adjective (shoulder-safe, knee-safe, joint-safe, back-safe, ...)
  [/\b[a-z]+-safe\b/gi, "lower-impact"],
  [/\binjury[-\s]?proof\b/gi, "resilience-focused"],
  [/\bpain[-\s]?free\b/gi, "comfortable"],
  [/\bprevents?\s+(injuries|injury|pain|reinjury)\b/gi, "supports your training"],
  [/\b(medically|doctor|clinically|physician|therapist)[-\s]?approved\b/gi, "informed by your profile"],
  [/\brehabilitat(e|es|ed|ing|ion)\b/gi, "train"],
  [/\bcures?\b/gi, "supports"],
  [/\bcuring\b/gi, "supporting"],
  [/\btreatments?\b/gi, "approach"],
  [/\btreats\b/gi, "supports"],
  [/\btreating\b/gi, "supporting"],
  [/\btreat\b/gi, "support"],
  [/\bguarantee(s|d)?\b/gi, "supports"],
  [/\bsafe\s+for\b/gi, "suited for"],
  [/\bsafely\b/gi, "comfortably"],
  [/\bsafer\b/gi, "gentler"],
  [/\bsafety\b/gi, "form"],
  [/\bsafe\b/gi, "suitable"],
];

// Single detector for the assertion + telemetry + tests. Matches ANY prohibited
// token; must NOT match the neutral replacement words above.
const DETECTOR = new RegExp(
  [
    "\\b[a-z]+-safe\\b",
    "\\bsafe\\b",
    "\\bsafer\\b",
    "\\bsafely\\b",
    "\\bsafety\\b",
    "\\bsafe\\s+for\\b",
    "\\binjury[-\\s]?proof\\b",
    "\\bpain[-\\s]?free\\b",
    "\\bprevents?\\s+(injuries|injury|pain|reinjury)\\b",
    "\\brehabilitat(e|es|ed|ing|ion)\\b",
    "\\bcures?\\b",
    "\\bcuring\\b",
    "\\btreat(s|ed|ing|ment|ments)?\\b",
    "\\bguarantee(s|d)?\\b",
    "\\b(medically|doctor|clinically|physician|therapist)[-\\s]?approved\\b",
  ].join("|"),
  "gi"
);

/** Return the list of prohibited claim substrings found in `text` (empty if clean). */
export function detectSafetyClaims(text: string | null | undefined): string[] {
  if (!text) return [];
  return (text.match(DETECTOR) || []).map((m) => m.trim());
}

/** Neutralize prohibited safety/medical/guarantee language. Deterministic. */
export function sanitizeSafetyLanguage(text: string | null | undefined): string {
  if (!text) return text ?? "";
  let out = text;
  for (const [re, repl] of REPLACEMENTS) out = out.replace(re, repl);
  // Collapse any double spaces a replacement may have left.
  return out.replace(/\s{2,}/g, " ").trim();
}

export interface SafetyFinding {
  path: string;
  before: string;
  after: string;
  claims: string[];
}

/**
 * Deep-walk any generated-plan-shaped object and sanitize user-visible string
 * fields in place (by key name). Returns the same object plus a list of findings
 * for logging. Safe to run on outlines, per-day results, and full plans — it only
 * touches keys in USER_VISIBLE_TEXT_KEYS.
 */
export function sanitizeGeneratedContent<T>(node: T, _path = ""): { value: T; findings: SafetyFinding[] } {
  const findings: SafetyFinding[] = [];

  const walk = (n: any, path: string): any => {
    if (typeof n === "string") return n; // strings are handled at the parent-key level
    if (Array.isArray(n)) return n.map((item, i) => walk(item, `${path}[${i}]`));
    if (n && typeof n === "object") {
      for (const key of Object.keys(n)) {
        const child = n[key];
        const childPath = path ? `${path}.${key}` : key;
        if (typeof child === "string" && USER_VISIBLE_TEXT_KEYS.has(key)) {
          const claims = detectSafetyClaims(child);
          if (claims.length) {
            const after = sanitizeSafetyLanguage(child);
            findings.push({ path: childPath, before: child, after, claims });
            n[key] = after;
          }
        } else if (child && typeof child === "object") {
          walk(child, childPath);
        }
      }
    }
    return n;
  };

  const value = walk(node, _path);
  return { value, findings };
}
