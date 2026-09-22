-- [#103] Attach demo assets to the Walking & Movement catalog rows.
--
-- LR-072 added the walks with no demo at all. On prod that left 1 of 7 walking
-- rows with a demo while 14 of 14 supporting movements in the same generated
-- plan had one — the walk was the only card in the plan without a demo, which
-- quietly reads as "this one is less of a real exercise". Exactly the framing
-- LR-072 existed to kill.
--
-- Split by whether there is form to teach, which is the rule the generation
-- prompt already states ("something like walking or cycling ... a link to a
-- public image ... instead"):
--
--   IMAGES — walking has no required form. A video would imply technique to
--   learn that does not exist. Self-hosted on the marketing site rather than
--   hotlinked: Unsplash CDN paths carry no file extension and isImageLink is
--   extension-only, hotlinks rot, and self-hosting keeps the licence position
--   unambiguous. Source images are Unsplash (free commercial, no attribution).
--
--   VIDEOS — these four DO have coaching cues, already written into their own
--   `instructions` column: don't hold the handrails, lean from the ankles not
--   the waist, pack the load high and tight, small steps on descents. All
--   verified embeddable through the same oEmbed call checkDemoLink makes.
--
-- Hill Walk Repeats deliberately gets an IMAGE, not a video: essentially all
-- hill-repeat video content is running, and showing a runner to someone whose
-- entire modality is walking undercuts the point. It is also `high`
-- difficulty, so the beginner guardrail hides it from the people most likely
-- to be put off anyway.
--
-- has_demo is set explicitly rather than left to checkDemoLink so this file is
-- self-contained; the values match what that function returns for each link.
-- Idempotent.

UPDATE exercises SET link = 'https://www.mastersfit.ai/assets/demo/walking.jpg',           has_demo = true, updated_at = NOW() WHERE name = 'Walking';
UPDATE exercises SET link = 'https://www.mastersfit.ai/assets/demo/brisk-walk.jpg',        has_demo = true, updated_at = NOW() WHERE name = 'Brisk Walk';
UPDATE exercises SET link = 'https://www.mastersfit.ai/assets/demo/hill-walk-repeats.jpg', has_demo = true, updated_at = NOW() WHERE name = 'Hill Walk Repeats';

-- Incline Walk — "Incline Walking On The Treadmill (Tutorial + Tips)", Vivian Ngo
UPDATE exercises SET link = 'https://www.youtube.com/watch?v=Ii71nAaRc_8', has_demo = true, updated_at = NOW() WHERE name = 'Incline Walk';
-- Rucking — "How To Start Rucking (Intro To Weighted Walking)", Dr. Marc Morris
UPDATE exercises SET link = 'https://www.youtube.com/watch?v=mq4rtoNw5ds', has_demo = true, updated_at = NOW() WHERE name = 'Rucking';
-- Hiking — "How to Walk Downhill | Hiking", SIKANA English
UPDATE exercises SET link = 'https://www.youtube.com/watch?v=HOl9FcuAmuY', has_demo = true, updated_at = NOW() WHERE name = 'Hiking';
