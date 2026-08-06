/**
 * Back-fill: give every existing user exactly one PRIMARY training_locations
 * row named "My usual place", mirroring their profile.environment + equipment
 * (spec §2.3 / §15.8).
 *
 * Idempotent: a user who already has a primary is left alone except that the
 * primary's environment/equipment are re-synced to the profile (name preserved).
 * Users with no environment set yet are skipped — nothing to anchor a place on.
 *
 * Safe by default: prints a plan and writes NOTHING unless you pass --apply.
 *
 *   npx tsx src/scripts/backfill-training-locations.ts            # dry-run
 *   npx tsx src/scripts/backfill-training-locations.ts --apply    # execute (local)
 *
 * Targets whatever DATABASE_URL points at. For prod, run via the deploy-db flow
 * after review — do NOT point this at Neon casually.
 */
import { db, pool } from "@/config/database";
import { profiles } from "@/models/profile.schema";
import { trainingLocations } from "@/models/training-location.schema";
import { profileService } from "@/services/profile.service";
import { trainingLocationService } from "@/services/training-location.service";
import { eq, and } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

async function hasPrimary(userId: number): Promise<boolean> {
  const rows = await db
    .select({ id: trainingLocations.id })
    .from(trainingLocations)
    .where(
      and(
        eq(trainingLocations.userId, userId),
        eq(trainingLocations.isPrimary, true)
      )
    )
    .limit(1);
  return rows.length > 0;
}

async function main() {
  const allProfiles = await db
    .select({ userId: profiles.userId })
    .from(profiles);

  console.log(
    `\nBack-fill training locations — ${APPLY ? "APPLY (writing)" : "DRY-RUN (no writes)"}`
  );
  console.log(`Profiles found: ${allProfiles.length}\n`);

  let toCreate = 0;
  let toResync = 0;
  let skippedNoEnv = 0;

  for (const { userId } of allProfiles) {
    // Read through the service so a stored {"home_gym"} array-literal is
    // normalized to a plain enum value before we mirror it.
    const profile = await profileService.getProfileByUserId(userId);
    const env = profile?.environment;
    if (!env) {
      skippedNoEnv++;
      continue;
    }
    const already = await hasPrimary(userId);
    const resolved = trainingLocationService.resolveEquipment(
      env,
      profile?.equipment ?? []
    );

    if (already) {
      toResync++;
    } else {
      toCreate++;
    }

    console.log(
      `  user ${userId}: ${already ? "resync existing primary" : 'CREATE "My usual place"'} ` +
        `→ env=${env}, equipment=[${resolved.join(", ")}]`
    );

    if (APPLY) {
      await trainingLocationService.syncPrimaryFromProfile(
        userId,
        env,
        profile?.equipment ?? []
      );
    }
  }

  console.log(
    `\nPlan: create ${toCreate} new primary rows, resync ${toResync} existing, ` +
      `skip ${skippedNoEnv} (no environment set).`
  );
  if (!APPLY) {
    console.log("\nDry-run only — re-run with --apply to write.\n");
  } else {
    console.log("\nApplied.\n");
  }

  await pool.end();
  process.exit(0);
}

main().catch(async (err) => {
  console.error(err);
  try {
    await pool.end();
  } catch {}
  process.exit(1);
});
