-- [LR-085] Make the walking entries reachable, and give the ladder a bottom rung.
--
-- LR-072 added five walks but they never reached a single generated plan. Three
-- separate reasons, all of which this file fixes on the DATA side (the pin in
-- utils/requested-exercises.ts fixes the CODE side):
--
--   1. No `walking_movement` tag existed anywhere in the catalog — 0 of 1,686
--      rows on prod. stratifyCatalog ranks a bucket by whether `tag` matches one
--      of the user's preferred styles, so a user who explicitly chose Walking &
--      Movement got no ranking benefit at all. LR-084 made the modality
--      first-class on the PROFILE side and the catalog side was never done.
--
--   2. Every walk listed `quads` as its first muscle group, and stratifyCatalog
--      buckets on muscle_groups[1] (Postgres 1-indexed). For a bodyweight-only
--      user that bucket is 95 deep, while `cardio` is 4 deep — so "Walking in
--      Place" was drawn on the first round-robin pass and "Brisk Walk" sat at
--      rank 85 of 95, far past the menu cutoff. Cardio-first is also simply the
--      more honest rating: a walk's training stimulus is cardiovascular, and
--      listing quads first also books a 25-minute walk as quad volume in
--      computeDayMuscleLoad, which treats muscle_groups[1] as the primary mover.
--
--   3. There was no `low`-difficulty walk framed as training. The bottom of the
--      ladder was "Gentle Recovery Walk" and "Walking Recovery" — both framed as
--      recovery — plus "Walking in Place", which is marching on the spot. So the
--      one walk-shaped movement a beginner could be shown was the stationary
--      one, and a 25-minute prescription of it is what prompted this fix.
--
-- Idempotent: safe to re-run against local or prod.

-- 1. The missing bottom rung. "Brisk Walk" stays `moderate` and keeps its pace
--    target; this is the same movement without one, for someone whose week-one
--    honest effort is simply going outside and walking. Deliberately NOT a
--    rename of Brisk Walk: that would leave the ladder with no moderate rung and
--    make the only progression walking -> incline, which skips a step.
INSERT INTO exercises (name, description, equipment, muscle_groups, difficulty, instructions, link, has_demo, tag)
VALUES (
  'Walking',
  'Going for a walk, at whatever pace is comfortable. A complete training session in its own right — the entry point of the ladder, not a warm-up and not a recovery filler.',
  ARRAY['bodyweight']::text[],
  ARRAY['cardio','quads','hamstrings','glutes','calves']::text[],
  'low',
  'Walk at a pace you could hold a conversation at. Stand tall, eyes forward, let the arms swing from the shoulder. There is no pace target — the only thing to progress is minutes. Indoors or outdoors, all at once or split across the day.',
  NULL, NULL,
  'walking_movement'
)
ON CONFLICT DO NOTHING;

-- 2. Tag the real walks so a Walking & Movement user's stated preference
--    actually ranks them, and put cardio first so they bucket as cardio.
--    "Power Walking" is an older row that is a genuine walk; it gets the tag too
--    (it currently reads `cardio`, which is true but not what the user chose).
UPDATE exercises
SET tag = 'walking_movement',
    muscle_groups = ARRAY['cardio']::text[] || array_remove(muscle_groups, 'cardio'),
    updated_at = NOW()
WHERE name IN ('Brisk Walk', 'Incline Walk', 'Hill Walk Repeats', 'Rucking', 'Hiking', 'Power Walking');

-- Deliberately NOT tagged: 'Walking in Place' and 'Gentle Walking in Place' are
-- stationary marching, which the Walking & Movement prompt explicitly forbids
-- for this style ("NEVER prescribe ... 'in place' cardio"). They stay in the
-- catalog for chair-based and limited-mobility programming, where they are the
-- right answer, but they must not be ranked as walking for someone who can walk.
-- 'Gentle Recovery Walk' and 'Walking Recovery' stay untagged too: both are
-- framed as recovery in their own instructions, and the whole point of LR-072
-- was that a walker's training should not be labelled recovery.
