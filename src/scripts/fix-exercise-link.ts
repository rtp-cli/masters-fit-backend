/**
 * Repoint ONE exercise's demo video at a corrected link.
 *
 * Why this exists: the catalog's demo links were picked by the model at
 * exercise-create time, and it sometimes lands on a video for the neighbouring
 * variant — e.g. "Dumbbell Romanian Deadlift" pointing at a BARBELL RDL demo.
 * has_demo was true and the video played, so no automated check caught it; a
 * tester watching the video did. This is the fix path for those reports.
 *
 * The link lives only on exercises.link and is joined into every workout at
 * read time, so one update corrects the demo for every past and future
 * workout — no app build or OTA needed.
 *
 * It prints the oEmbed TITLE of both the old and the new video, because the
 * whole class of bug is a title/exercise mismatch that only a human can judge.
 * Read the new title before you trust it. has_demo is re-derived from the new
 * link (oEmbed), so a dead link is recorded honestly rather than assumed good.
 *
 * SAFE BY DESIGN: refuses to run against a non-local DATABASE_URL unless you
 * pass --remote. Touches exactly the one exercise row you name — and only its
 * link/has_demo columns. Pass --dry-run to preview without writing.
 * Reversible: the old link is printed, so you can re-run with it to roll back.
 *
 * Usage:
 *   # Preview against the LOCAL db:
 *   npm run fix-exercise-link -- --id 1131 \
 *     --link 'https://www.youtube.com/watch?v=hQgFixeXdZo' --dry-run
 *
 *   # Identify by exact name instead of id:
 *   npm run fix-exercise-link -- --name 'Dumbbell Romanian Deadlift' \
 *     --link 'https://www.youtube.com/watch?v=hQgFixeXdZo'
 *
 *   # Against production (Neon) — never hand-paste the URL, use the wrapper:
 *   scripts/with-prod-url.sh npm run fix-exercise-link -- --id 1131 \
 *     --link 'https://www.youtube.com/watch?v=hQgFixeXdZo' --remote
 */

import { db } from "@/config/database";
import { exercises } from "@/models/exercise.schema";
import { checkDemoLink, extractYouTubeVideoId } from "@/utils/video-validation";
import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
function argValue(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  return idx !== -1 ? process.argv[idx + 1] : undefined;
}

const idArg = argValue("--id");
const nameArg = argValue("--name");
const newLink = argValue("--link");
const allowRemote = process.argv.includes("--remote");
const dryRun = process.argv.includes("--dry-run");

const USAGE =
  "Usage: npm run fix-exercise-link -- (--id <id> | --name <exact name>) " +
  "--link <url> [--remote] [--dry-run]";

if ((!idArg && !nameArg) || (idArg && nameArg) || !newLink) {
  console.error(USAGE);
  process.exit(1);
}

const exerciseId = idArg ? Number(idArg) : undefined;
if (idArg && !Number.isInteger(exerciseId)) {
  console.error(`--id must be an integer, got "${idArg}".`);
  process.exit(1);
}

// Reject a link we cannot even parse before touching the database — a
// non-YouTube or malformed URL would just set has_demo=false and silently
// remove the demo button, which is worse than the wrong video.
if (!extractYouTubeVideoId(newLink!)) {
  console.error(
    `--link is not a parseable YouTube URL: ${newLink}\n` +
      `Expected e.g. https://www.youtube.com/watch?v=<id> or https://youtu.be/<id>.`
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Guardrail: local-only unless --remote (mirrors reset-workout-day.ts)
// ---------------------------------------------------------------------------
function assertLocalDatabase(): void {
  const url = process.env.DATABASE_URL || "";
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch {
    console.error("DATABASE_URL is unset or unparseable. Aborting.");
    process.exit(1);
  }
  const isLocal = ["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host);
  console.log(`DATABASE_URL host: ${host} (local=${isLocal})`);
  if (!isLocal && !allowRemote) {
    console.error(
      `Refusing to run: host "${host}" is not local. This script is ` +
        `LOCAL-ONLY by default.\n` +
        `Re-run with --remote to fix a demo link on a non-local database ` +
        `(e.g. Neon). Only the one exercise row is touched.`
    );
    process.exit(1);
  }
  if (!isLocal) {
    console.warn(
      `⚠️  --remote: operating on NON-LOCAL database "${host}".`
    );
  }
}

/**
 * The video's title as YouTube reports it. This is the operator's only real
 * check that the link matches the exercise, so a lookup failure is reported
 * rather than swallowed.
 */
async function videoTitle(link: string | null): Promise<string> {
  if (!link) return "(no link)";
  const videoId = extractYouTubeVideoId(link);
  if (!videoId) return "(unparseable link)";
  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`
    );
    if (!res.ok) return `(oEmbed ${res.status} — video may be dead)`;
    const data = (await res.json()) as { title?: string; author_name?: string };
    return `${data.title ?? "?"} — ${data.author_name ?? "?"}`;
  } catch {
    return "(oEmbed lookup failed — network)";
  }
}

async function main(): Promise<void> {
  assertLocalDatabase();

  const [exercise] = await db
    .select()
    .from(exercises)
    .where(
      exerciseId !== undefined
        ? eq(exercises.id, exerciseId)
        : eq(exercises.name, nameArg!)
    )
    .limit(1);

  if (!exercise) {
    console.error(
      exerciseId !== undefined
        ? `No exercise with id ${exerciseId}.`
        : `No exercise named exactly "${nameArg}". Names are case-sensitive here.`
    );
    process.exit(1);
  }

  if (exercise.link === newLink) {
    console.log(
      `Exercise ${exercise.id} "${exercise.name}" already points at that link. Nothing to do.`
    );
    return;
  }

  const [oldTitle, newTitle, newHasDemo] = await Promise.all([
    videoTitle(exercise.link),
    videoTitle(newLink!),
    checkDemoLink(newLink!),
  ]);

  console.log(`\nExercise ${exercise.id}: ${exercise.name}`);
  console.log(`  old link : ${exercise.link ?? "(none)"}`);
  console.log(`  old video: ${oldTitle}`);
  console.log(`  new link : ${newLink}`);
  console.log(`  new video: ${newTitle}`);
  console.log(`  has_demo : ${exercise.hasDemo} -> ${newHasDemo}`);
  console.log(
    `\n  ^ Confirm the new title describes "${exercise.name}" before trusting this.`
  );

  if (newHasDemo === false) {
    console.error(
      `\nRefusing to write: oEmbed says the new video is not playable/embeddable. ` +
        `Setting it would remove the demo button entirely. Pick another video.`
    );
    process.exit(1);
  }

  if (dryRun) {
    console.log(
      `\n--dry-run: no changes written. Would have set exercises.link and ` +
        `has_demo on row ${exercise.id}.`
    );
    return;
  }

  await db
    .update(exercises)
    .set({ link: newLink, hasDemo: newHasDemo, updatedAt: new Date() })
    .where(eq(exercises.id, exercise.id));

  console.log(`\n✅ Updated exercise ${exercise.id} "${exercise.name}".`);
  console.log(
    `   To roll back: npm run fix-exercise-link -- --id ${exercise.id} ` +
      `--link '${exercise.link ?? ""}'${allowRemote ? " --remote" : ""}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("fix-exercise-link failed:", error);
    process.exit(1);
  });
