/**
 * [GQ-09] Canonical muscle-group taxonomy.
 *
 * The exercises.muscle_groups column accumulated ~96 inconsistent labels over
 * time (casing/separator variants, synonyms, joints, multi-packed single cells,
 * and non-muscle junk). This is the canonical enum (18 groups) plus the complete
 * raw-label -> canonical mapping used to normalize the data (see
 * scripts/migrate-muscle-taxonomy.ts) and to normalize any labels going forward.
 *
 * Granularity is anchored to the consecutive-day muscle-overload check: quads /
 * hamstrings / glutes stay distinct (masters athletes notice), `hips` stays
 * separate from `glutes` (mobility vs strength), and `back` vs `lower_back` stay
 * split because lower-back overload is the most important thing to catch. Fine
 * anatomical labels (lats, rhomboids, traps, rear delts, rotator cuff, etc.)
 * collapse into their parent group — too sparse and too jargon-y for display.
 */

export const MuscleGroups = {
  CHEST: "chest",
  BACK: "back",
  SHOULDERS: "shoulders",
  BICEPS: "biceps",
  TRICEPS: "triceps",
  FOREARMS: "forearms",
  CORE: "core",
  LOWER_BACK: "lower_back",
  GLUTES: "glutes",
  QUADS: "quads",
  HAMSTRINGS: "hamstrings",
  ADDUCTORS: "adductors",
  HIPS: "hips",
  HIP_FLEXORS: "hip_flexors",
  CALVES: "calves",
  NECK: "neck",
  CARDIO: "cardio",
  FULL_BODY: "full_body",
} as const;

export type MuscleGroup = (typeof MuscleGroups)[keyof typeof MuscleGroups];

export const CANONICAL_MUSCLE_GROUPS: string[] = Object.values(MuscleGroups);

/** Title-case display names for the frontend. */
export const MUSCLE_GROUP_DISPLAY: Record<string, string> = {
  chest: "Chest",
  back: "Back",
  shoulders: "Shoulders",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  core: "Core",
  lower_back: "Lower Back",
  glutes: "Glutes",
  quads: "Quads",
  hamstrings: "Hamstrings",
  adductors: "Adductors",
  hips: "Hips",
  hip_flexors: "Hip Flexors",
  calves: "Calves",
  neck: "Neck",
  cardio: "Cardio",
  full_body: "Full Body",
};

/**
 * Complete raw-label -> canonical[] mapping, keyed by the EXACT lowercased/
 * trimmed production label (all 96 distinct prod values as of 2026-08-04).
 * Multi-packed cells (e.g. "lats triceps shoulders") map to multiple canonicals;
 * junk maps to [] (dropped). Order within each value is preserved so the
 * "first muscle group" bucketing stays stable.
 */
export const RAW_MUSCLE_LABEL_MAP: Record<string, string[]> = {
  // identity / casing / separator / synonym collapses
  core: ["core"],
  glutes: ["glutes"],
  shoulders: ["shoulders"],
  quads: ["quads"],
  quadriceps: ["quads"],
  hamstrings: ["hamstrings"],
  hips: ["hips"],
  chest: ["chest"],
  calves: ["calves"],
  calf_muscles: ["calves"],
  "upper chest": ["chest"],
  back: ["back"],
  obliques: ["core"],
  abdominals: ["core"],
  lower_abs: ["core"],
  upper_abs: ["core"],
  transverse_abdominis: ["core"],
  triceps: ["triceps"],
  biceps: ["biceps"],
  hip_flexors: ["hip_flexors"],
  "hip flexors": ["hip_flexors"],
  psoas: ["hip_flexors"],
  "lower back": ["lower_back"],
  lower_back: ["lower_back"],
  upper_back: ["back"],
  "upper back": ["back"],
  lats: ["back"],
  traps: ["back"],
  upper_traps: ["back"],
  rhomboids: ["back"],
  scapular_stabilizers: ["back"],
  erector_spinae: ["lower_back"],
  spine: ["lower_back"],
  full_body: ["full_body"],
  "full body": ["full_body"],
  forearms: ["forearms"],
  cardiovascular: ["cardio"],
  cardio: ["cardio"],
  cardio_system: ["cardio"],
  cardiovascular_system: ["cardio"],
  respiratory: ["cardio"],
  diaphragm: ["cardio"],
  neck: ["neck"],
  rear_delts: ["shoulders"],
  "rear deltoids": ["shoulders"],
  "anterior deltoids": ["shoulders"],
  delts: ["shoulders"],
  rotator_cuff: ["shoulders"],
  groin: ["adductors"],
  inner_thighs: ["adductors"],
  "inner thighs": ["adductors"],
  adductors: ["adductors"],
  hip_adductors: ["adductors"],
  outer_thigh: ["hips"],
  hip_abductors: ["hips"],
  hip_stabilizers: ["hips"],
  piriformis: ["hips"],
  // umbrella labels (split into multiple canonicals)
  legs: ["quads", "hamstrings", "glutes"],
  thighs: ["quads", "hamstrings"],
  arms: ["biceps", "triceps"],
  posterior_chain: ["glutes", "hamstrings", "lower_back"],
  "leg power": ["quads", "glutes"],
  // joints / extremities folded into nearest muscle group
  ankles: ["calves"],
  shins: ["calves"],
  feet: ["calves"],
  toes: ["calves"],
  lower_legs: ["calves"],
  ankle_muscles: ["calves"],
  ankle_stabilizers: ["calves"],
  knees: ["quads"],
  wrists: ["forearms"],
  hands: ["forearms"],
  grip: ["forearms"],
  // multi-packed cells (split on space, map each token, dedupe, keep order)
  "shoulders upper_back": ["shoulders", "back"],
  "calves ankles": ["calves"],
  "spine core": ["lower_back", "core"],
  "hamstrings nerves": ["hamstrings"],
  "hips glutes": ["hips", "glutes"],
  "adductors hips": ["adductors", "hips"],
  "lower_back pelvis": ["lower_back", "hips"],
  "hips groin": ["hips", "adductors"],
  "shoulders rotator_cuff": ["shoulders"],
  "hip_flexors quads": ["hip_flexors", "quads"],
  "wrists forearms": ["forearms"],
  "ankles calves": ["calves"],
  "outer_thigh hips": ["hips"],
  "lats triceps shoulders": ["back", "triceps", "shoulders"],
  "hips ankles spine": ["hips", "calves", "lower_back"],
  "spine upper_back": ["lower_back", "back"],
  "quads hip_flexors": ["quads", "hip_flexors"],
  "hamstrings hips spine": ["hamstrings", "hips", "lower_back"],
  "adductors glutes ankles": ["adductors", "glutes", "calves"],
  "spine hips": ["lower_back", "hips"],
  "wrists shoulders": ["forearms", "shoulders"],
  "upper_back shoulders": ["back", "shoulders"],
  "glutes core shoulders": ["glutes", "core", "shoulders"],
  "chest upper_back": ["chest", "back"],
  "hamstrings shoulders spine": ["hamstrings", "shoulders", "lower_back"],
  "hamstrings spine calves": ["hamstrings", "lower_back", "calves"],
  // junk (dropped)
  "": [],
  resistance_bands: [],
  mind: [],
  balance: ["full_body"],
};

/**
 * Normalizes a raw muscle_groups array to canonical values: order-preserving,
 * deduped, junk dropped. Labels not present in the map are returned in
 * `unmapped` (and NOT included in `groups`) so a migration can surface them
 * rather than silently passing through non-canonical data.
 */
export function normalizeMuscleGroups(raw: string[] | null | undefined): {
  groups: string[];
  unmapped: string[];
} {
  const groups: string[] = [];
  const seen = new Set<string>();
  const unmapped: string[] = [];
  for (const label of raw || []) {
    const key = (label || "").trim().toLowerCase();
    const mapped = RAW_MUSCLE_LABEL_MAP[key];
    if (mapped === undefined) {
      if (key.length > 0) unmapped.push(key);
      continue;
    }
    for (const canonical of mapped) {
      if (!seen.has(canonical)) {
        seen.add(canonical);
        groups.push(canonical);
      }
    }
  }
  return { groups, unmapped };
}
