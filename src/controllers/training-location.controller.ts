import {
  Body,
  Controller,
  Delete,
  Get,
  Path,
  Post,
  Put,
  Route,
  SuccessResponse,
  Security,
  Tags,
} from "@tsoa/runtime";

import { trainingLocationService, workoutService } from "@/services";
import { TrainingLocation } from "@/models/training-location.schema";

interface CreateLocationBody {
  /** Display name for the saved place, e.g. "Group session". */
  name: string;
  /** Enum value: home_gym | commercial_gym | bodyweight_only. */
  environment: string;
  /** Only meaningful for home_gym; resolved server-side otherwise. */
  equipment?: string[];
}

interface UpdateLocationBody {
  name?: string;
  environment?: string;
  equipment?: string[];
}

interface SetDayLocationBody {
  /** Provenance; null for a one-off or the standing "Bodyweight only" pick. */
  locationId: number | null;
  name: string;
  environment: string;
  equipment: string[];
}

@Route("training-locations")
@Tags("TrainingLocations")
@Security("bearerAuth")
export class TrainingLocationController extends Controller {
  /** All of a user's places, primary first (spec §5 / §8). */
  @Get("/{userId}")
  @SuccessResponse(200, "Success")
  public async list(
    @Path() userId: number
  ): Promise<{ success: boolean; locations: TrainingLocation[] }> {
    const locations = await trainingLocationService.getUserLocations(userId);
    return { success: true, locations };
  }

  /** Save a new secondary place (spec §6 "Save this place"). */
  @Post("/{userId}")
  @SuccessResponse(201, "Created")
  public async create(
    @Path() userId: number,
    @Body() body: CreateLocationBody
  ): Promise<{ success: boolean; location: TrainingLocation }> {
    const location = await trainingLocationService.createSecondary(userId, body);
    this.setStatus(201);
    return { success: true, location };
  }

  /** Rename / re-equip a place (spec §8 place detail). */
  @Put("/{userId}/{locationId}")
  @SuccessResponse(200, "Success")
  public async update(
    @Path() userId: number,
    @Path() locationId: number,
    @Body() body: UpdateLocationBody
  ): Promise<{ success: boolean; location: TrainingLocation }> {
    const location = await trainingLocationService.updateLocation(
      userId,
      locationId,
      body
    );
    return { success: true, location };
  }

  /** Promote a secondary to primary ("Make my usual place", spec §8). */
  @Post("/{userId}/{locationId}/make-primary")
  @SuccessResponse(200, "Success")
  public async makePrimary(
    @Path() userId: number,
    @Path() locationId: number
  ): Promise<{ success: boolean; location: TrainingLocation }> {
    const location = await trainingLocationService.makePrimary(
      userId,
      locationId
    );
    return { success: true, location };
  }

  /** Remove a saved secondary and free a slot (spec §8). */
  @Delete("/{userId}/{locationId}")
  @SuccessResponse(200, "Success")
  public async remove(
    @Path() userId: number,
    @Path() locationId: number
  ): Promise<{ success: boolean }> {
    await trainingLocationService.deleteLocation(userId, locationId);
    return { success: true };
  }

  /**
   * Record the session's location on a plan day WITHOUT regenerating (spec §9).
   * The picker uses this when the chosen place needs no rebuild — it freezes the
   * snapshot so history stays true even if the place is later renamed/deleted.
   */
  @Put("/{userId}/plan-day/{planDayId}")
  @SuccessResponse(200, "Success")
  public async setDayLocation(
    @Path() userId: number,
    @Path() planDayId: number,
    @Body() body: SetDayLocationBody
  ): Promise<{ success: boolean }> {
    await workoutService.setPlanDayLocation(userId, planDayId, {
      locationId: body.locationId,
      name: body.name,
      environment: body.environment as any,
      equipment: (body.equipment ?? []) as any,
    });
    return { success: true };
  }
}
