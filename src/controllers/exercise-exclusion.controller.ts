import {
  Body,
  Controller,
  Delete,
  Get,
  Path,
  Post,
  Query,
  Route,
  Response,
  SuccessResponse,
  Security,
  Tags,
} from "@tsoa/runtime";

import { exerciseExclusionService } from "@/services";
import {
  EXERCISE_EXCLUSION_REASONS,
  type ExerciseExclusionReason,
} from "@/models";
import { ApiResponse } from "@/types/common/responses";

interface ExclusionItem {
  exerciseId: number;
  reason: ExerciseExclusionReason;
}

interface AddExclusionsBody {
  /** The originating exercise plus any ticked in the 1d pain branch. */
  exclusions: ExclusionItem[];
  /**
   * A PhysicalLimitations enum value to add to the profile — a separate,
   * explicit opt-in from 1d. Never inferred from an exclusion.
   */
  addLimitation?: string | null;
}

function isReason(value: unknown): value is ExerciseExclusionReason {
  return (
    typeof value === "string" &&
    (EXERCISE_EXCLUSION_REASONS as string[]).includes(value)
  );
}

@Route("exclusions")
@Tags("Exclusions")
@Security("bearerAuth")
export class ExerciseExclusionController extends Controller {
  /**
   * List the user's excluded exercises (flat, ordered by reason then date) so
   * the client can group them for Settings → Excluded exercises.
   */
  @Get("/{userId}")
  @SuccessResponse(200, "Success")
  public async listExclusions(@Path() userId: number): Promise<{
    success: boolean;
    exclusions: {
      exerciseId: number;
      name: string;
      muscleGroups: string[];
      reason: ExerciseExclusionReason;
      createdAt: Date;
    }[];
  }> {
    const exclusions = await exerciseExclusionService.listExclusions(userId);
    return { success: true, exclusions };
  }

  /**
   * Ranked replacements for a slot: muscle-overlap desc → difficulty distance
   * asc → hasDemo first, over owned equipment only, with the original and all
   * exclusions filtered out.
   */
  @Get("/{userId}/replacements")
  @SuccessResponse(200, "Success")
  public async getReplacements(
    @Path() userId: number,
    @Query() exerciseId: number,
    @Query() limit?: number
  ) {
    const candidates = await exerciseExclusionService.rankReplacements(
      userId,
      exerciseId,
      limit ?? 3
    );
    return { success: true, candidates };
  }

  /**
   * Future incomplete plan days that still contain the exercise — day names
   * only, for the 1c sweep disclosure.
   */
  @Get("/{userId}/sweep-preview")
  @SuccessResponse(200, "Success")
  public async getSweepPreview(
    @Path() userId: number,
    @Query() exerciseId: number
  ) {
    const { dayNames } = await exerciseExclusionService.getSweepPreview(
      userId,
      exerciseId
    );
    return { success: true, dayNames };
  }

  /**
   * Other exercises scheduled in the upcoming plan that overlap on muscle group
   * — the 1d list.
   */
  @Get("/{userId}/related")
  @SuccessResponse(200, "Success")
  public async getRelated(
    @Path() userId: number,
    @Query() exerciseId: number
  ) {
    const related = await exerciseExclusionService.getRelatedScheduled(
      userId,
      exerciseId
    );
    return { success: true, related };
  }

  /**
   * Commit exclusions: persist them, optionally add a limitation (explicit
   * opt-in), and sweep future plan days. Returns the swept day names.
   */
  @Post("/{userId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(201, "Created")
  public async addExclusions(
    @Path() userId: number,
    @Body() body: AddExclusionsBody
  ): Promise<{ success: boolean; sweptDayNames: string[] }> {
    const items = Array.isArray(body?.exclusions) ? body.exclusions : [];
    const clean = items
      .filter(
        (it) => typeof it?.exerciseId === "number" && isReason(it?.reason)
      )
      .map((it) => ({ exerciseId: it.exerciseId, reason: it.reason }));

    if (clean.length === 0) {
      this.setStatus(400);
      return { success: false, sweptDayNames: [] };
    }

    const { sweptDayNames } = await exerciseExclusionService.addExclusions(
      userId,
      clean,
      body.addLimitation ?? null
    );
    this.setStatus(201);
    return { success: true, sweptDayNames };
  }

  /**
   * Allow an exercise back (the 1g reversal).
   */
  @Delete("/{userId}/{exerciseId}")
  @SuccessResponse(200, "Success")
  public async removeExclusion(
    @Path() userId: number,
    @Path() exerciseId: number
  ): Promise<ApiResponse> {
    await exerciseExclusionService.removeExclusion(userId, exerciseId);
    return { success: true };
  }
}
