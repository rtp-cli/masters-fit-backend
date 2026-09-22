-- [#102] "Indoor Walk" — the walk you do when you cannot get outside.
--
-- Rich asked for walking-in-place to be OFFERED as a swap rather than built as
-- a tier of the walking ladder. The distinction matters: in-place walking is a
-- CONSTRAINT answer (weather, no safe sidewalk, housebound, caregiving, night
-- shift), not a DIFFICULTY answer. Twenty minutes of marching on the spot is
-- not easier than a fifteen-minute stroll, it is just the only thing available.
-- So it sits on a different axis from Walking -> Brisk -> Incline -> Hill, and
-- it is reached by the user saying so, never by the generator deciding.
--
-- Why a NEW row rather than reusing "Gentle Walking in Place" (prod 2002):
-- that row describes itself as "gentle movement and maintaining heart rate in
-- recovery zone". For someone whose walk IS their session, being handed
-- something framed as recovery is the exact bias LR-072 was written to end.
-- 2002 also has 18 prescriptions across 4 real users, so renaming it would
-- rewrite what those people were shown in their own logs. It stays untouched.
--
-- NEVER GENERATED. This row is excluded from the generation catalog for every
-- user by SWAP_ONLY_EXERCISES in utils/walking-modality.ts. The name carries
-- none of the words NON_WALKING_CARDIO matches — no "in place", no "jog", no
-- "run" — so without that explicit exclusion the generator would happily start
-- prescribing it and we would have rebuilt the LR-085 defect under a nicer
-- name. If you rename this row, rename it there too.
--
-- Idempotent.

INSERT INTO exercises (name, description, equipment, muscle_groups, difficulty, instructions, link, has_demo, tag)
VALUES (
  'Indoor Walk',
  'The same walk, done indoors when getting outside is not an option. A complete session in its own right — not a recovery filler, and not a lesser version of the outdoor walk.',
  ARRAY['bodyweight']::text[],
  ARRAY['cardio','quads','hamstrings','glutes','calves']::text[],
  'low',
  'March on the spot at the pace you would walk outdoors — knees to a comfortable height, arms swinging from the shoulder. Keep the same duration you would have walked for; the clock is the target, not the step count. A hallway or a few paces back and forth works just as well if you have the room.',
  NULL, NULL,
  'walking_movement'
)
ON CONFLICT DO NOTHING;
