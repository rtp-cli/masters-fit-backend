-- [#116] Stretches and breathing drills that claim to need a foam roller.
--
-- Found reading two real beginners' first plans (users 138, 157) on
-- 2026-09-21: "Wrist Flexor Stretch" required a bench, "Chin to Chest Stretch"
-- a foam roller, "Neck Rolls" a foam roller. Almost certainly LLM-authored
-- `exercisesToAdd` rows where the model echoed the surrounding block's
-- equipment instead of the movement's own needs — validateExerciseData checks
-- that equipment values are known ENUM MEMBERS, never that they are plausible
-- for the movement, so {foam_roller} on a neck stretch passes cleanly.
--
-- WHY THIS IS URGENT RATHER THAN COSMETIC: #114 (merged the same day) made it
-- load-bearing. Before that fix `userEquipmentOnly` was a no-op for
-- bodyweight-only users — their empty `equipment` column meant the filter was
-- skipped entirely — so junk tags were invisible. Now that the filter correctly
-- resolves to ["bodyweight"], every one of these rows is EXCLUDED from those
-- users, and they are exactly the gentle movements the least-equipped people
-- most need. The fix was right; the data is wrong.
--
-- DELIBERATELY NARROW. Only rows that are (a) a stretch / breathing / neck or
-- cat-cow movement by name, and (b) do NOT mention the equipment they claim.
-- That second clause is what spares the legitimate ones — "Foam Roller Lat
-- Stretch", "Bench Hip Flexor Stretch", "Pec Stretch on Stability Ball" and
-- "Lat Prayer Stretch on Bench" all keep their equipment. 62 rows on prod.
--
-- The wider pattern (standing/seated/supine names) matches ~220 rows and is NOT
-- touched here: "Seated Dumbbell Press" legitimately needs dumbbells, so that
-- set needs a human pass rather than a predicate.
--
-- Idempotent: re-running matches nothing once applied, because the rows then
-- carry {bodyweight}.

UPDATE exercises e
SET equipment = ARRAY['bodyweight']::text[], updated_at = NOW()
WHERE e.equipment IS NOT NULL
  AND cardinality(e.equipment) > 0
  AND NOT ('bodyweight' = ANY(e.equipment))
  AND e.name ~* '(stretch|breathing|cat.?cow|neck (roll|release)|shoulder roll)'
  AND NOT EXISTS (
    SELECT 1 FROM unnest(e.equipment) q
    WHERE e.name ~* replace(replace(q, '_', ' '), 'incline decline bench', 'bench')
  );

-- Rollback is not automatic: the previous values were per-row (mostly
-- {foam_roller}, some {bench}). If this needs reverting, restore from the
-- affected-id list printed by the apply script rather than guessing.
