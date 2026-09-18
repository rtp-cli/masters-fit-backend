-- [LR-072] Walking as a primary training modality.
--
-- The catalog had no plain walk. Everything matching "walk" was a glute
-- activation drill (Band Walk, Monster Walk), a balance drill (Heel-to-Toe),
-- or explicitly recovery ("Gentle Recovery Walk", "Gentle Walking in Place").
-- Meanwhile prescribed cardio is bikes, rowers and burpees.
--
-- That fails the audience: 15 of 22 users with a stated age are 40+, 8 are 50+,
-- and for a deconditioned older adult walking may be the ONLY training
-- available for the first months. A catalog that only offers "gentle recovery
-- walk" tells that person their training does not count.
--
-- Duration/distance-based: prescribed with a duration, not sets and reps.
INSERT INTO exercises (name, description, equipment, muscle_groups, difficulty, instructions, link, has_demo)
VALUES
  (
    'Brisk Walk',
    'Continuous walking at a purposeful pace for cardiovascular endurance. A primary training session in its own right, not a warm-up or a recovery filler.',
    ARRAY['bodyweight']::text[],
    ARRAY['quads','hamstrings','glutes','calves','cardio']::text[],
    'moderate',
    'Walk at a pace where you can talk in short sentences but not sing — roughly 100-120 steps per minute. Stand tall, eyes forward, let the arms swing naturally from the shoulder. Progress by adding minutes before adding pace.',
    NULL, NULL
  ),
  (
    'Incline Walk',
    'Sustained walking up a gradient — a treadmill incline or a steady hill. Raises effort and loads the calves, glutes and quads without the impact of running.',
    ARRAY['bodyweight']::text[],
    ARRAY['quads','glutes','calves','cardio']::text[],
    'moderate',
    'Set a 5-12% grade or find a steady hill. Lean slightly forward from the ankles, not the waist. Do not hold the handrails — that removes most of the work. Shorten the stride rather than slowing down.',
    NULL, NULL
  ),
  (
    'Hill Walk Repeats',
    'Repeated hard walking efforts up a hill with easy downhill recovery. Interval conditioning with no running impact.',
    ARRAY['bodyweight']::text[],
    ARRAY['quads','hamstrings','glutes','calves','cardio']::text[],
    'high',
    'Walk up the hill briskly for 60-90 seconds at an effort you could hold for about three minutes. Walk back down easily and fully recover. Repeat. Add repeats before adding steepness.',
    NULL, NULL
  ),
  (
    'Rucking',
    'Walking with a weighted pack. Adds load and bone-loading stimulus to walking without adding impact, and carries over directly to everyday lifting and carrying.',
    ARRAY['bodyweight']::text[],
    ARRAY['quads','hamstrings','glutes','calves','core','back','cardio']::text[],
    'moderate',
    'Start with 10-15 lb, or about 10% of bodyweight, in a backpack. Pack the load high and tight against the spine so it does not swing. Stand tall — do not lean forward to counterbalance. Add weight only after the duration is comfortable.',
    NULL, NULL
  ),
  (
    'Hiking',
    'Walking on trail or uneven terrain with elevation change. Distinct from a road walk: the varying surface adds balance, ankle stability and hip work, and descents load the legs eccentrically.',
    ARRAY['bodyweight']::text[],
    ARRAY['quads','hamstrings','glutes','calves','core','cardio']::text[],
    'moderate',
    'Shorten the stride on climbs and let the pace drop — effort, not speed, is the target. On descents take smaller steps and let the knees stay soft; this is where most of the soreness comes from. Poles help if balance or knees are a concern.',
    NULL, NULL
  )
ON CONFLICT DO NOTHING;
