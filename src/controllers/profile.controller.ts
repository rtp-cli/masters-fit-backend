import { profileService, userService } from "@/services";
import { eventTrackingService } from "@/services/event-tracking.service";
import { signupNotificationService } from "@/services/signup-notification.service";
import { logger } from "@/utils/logger";
import { Profile, ProfileResponse } from "@/types/profile/types";
import { ApiResponse } from "@/types/common/responses";
import {
  Body,
  Controller,
  Get,
  Path,
  Post,
  Put,
  Route,
  SuccessResponse,
  Tags,
  Response,
  Example,
  Security,
  Request,
} from "@tsoa/runtime";

// Helper function to get client IP from request
function getClientIP(req: any): string | undefined {
  if (!req) return undefined;
  return req.clientIP || req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || undefined;
}

@Route("profile")
@Tags("Profile")
@Security("bearerAuth")
export class ProfileController extends Controller {
  /**
   * Fire the internal "new user finished onboarding" alert.
   *
   * Deliberately NOT awaited and deliberately returns void: onboarding
   * completion is a person waiting on a screen, and no part of an ops email —
   * not a database read, not a Resend round-trip, not an outage — may add
   * latency to that response or fail it.
   *
   * `dispatchNewUserAlert` is written to never reject; the `.catch` here is a
   * second belt against an unhandled rejection ever reaching the process if
   * that contract is later broken. The dispatcher itself no-ops unless
   * SIGNUP_NOTIFY_ENABLED is set, so this line is inert by default.
   */
  private notifyOwnerOfNewUser(userId: number): void {
    void signupNotificationService.dispatchNewUserAlert(userId).catch((error) => {
      logger.error("New-user alert dispatch rejected unexpectedly", error as Error, {
        operation: "notifyOwnerOfNewUser",
        userId,
      });
    });
  }

  /**
   * Get the user's profile
   */
  @Get("/{userId}")
  @Response<ApiResponse>(400, "Bad Request")
  public async getProfile(@Path() userId: number): Promise<ProfileResponse> {
    const dbProfile = await profileService.getProfileByUserId(userId);
    if (!dbProfile) {
      throw new Error("Profile not found");
    }
    const profile: Profile = {
      id: dbProfile.id,
      userId: dbProfile.userId,
      height: dbProfile.height ?? undefined,
      weight: dbProfile.weight ?? undefined,
      age: dbProfile.age ?? undefined,
      gender: dbProfile.gender ?? undefined,
      goals: dbProfile.goals ?? undefined,
      fitnessLevel: dbProfile.fitnessLevel ?? undefined,
      limitations: dbProfile.limitations ?? undefined,
      medicalNotes: dbProfile.medicalNotes ?? undefined,
      environment: dbProfile.environment ?? undefined,
      equipment: dbProfile.equipment ?? undefined,
      otherEquipment: dbProfile.otherEquipment ?? undefined,
      preferredStyles: dbProfile.preferredStyles ?? undefined,
      availableDays: dbProfile.availableDays ?? undefined,
      workoutDuration: dbProfile.workoutDuration ?? undefined,
      intensityLevel: dbProfile.intensityLevel ?? undefined,
      includeWarmup: dbProfile.includeWarmup ?? true,
      includeCooldown: dbProfile.includeCooldown ?? true,
      created_at: dbProfile.updatedAt ?? new Date(),
      updated_at: dbProfile.updatedAt ?? new Date(),
    };
    return {
      success: true,
      profile,
    };
  }

  /**
   * Create or update the user's profile
   */
  @Post("/")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(201, "Created")
  public async createProfile(
    @Body() requestBody: Partial<Profile>,
    @Request() request: any
  ): Promise<ProfileResponse> {
    const dbProfile = await profileService.createOrUpdateProfile({
      userId: requestBody.userId!,
      height: requestBody.height ?? null,
      weight: requestBody.weight ?? null,
      age: requestBody.age ?? null,
      gender: requestBody.gender ?? null,
      // @ts-ignore - TypeScript types mismatch with Drizzle schema
      goals: requestBody.goals ?? null,
      fitnessLevel: requestBody.fitnessLevel ?? null,
      // @ts-ignore - TypeScript types mismatch with Drizzle schema
      limitations: requestBody.limitations ?? null,
      medicalNotes: requestBody.medicalNotes ?? null,
      environment: requestBody.environment ?? null,
      // @ts-ignore - TypeScript types mismatch with Drizzle schema
      equipment: requestBody.equipment ?? null,
      otherEquipment: requestBody.otherEquipment ?? null,
      // @ts-ignore - TypeScript types mismatch with Drizzle schema
      preferredStyles: requestBody.preferredStyles ?? null,
      // @ts-ignore - TypeScript types mismatch with Drizzle schema
      availableDays: requestBody.availableDays ?? null,
      workoutDuration: requestBody.workoutDuration ?? null,
      intensityLevel: requestBody.intensityLevel ?? null,
      includeWarmup: requestBody.includeWarmup ?? true,
      includeCooldown: requestBody.includeCooldown ?? true,
      timezone: requestBody.timezone ?? null,
    });
    const profile: Profile = {
      id: dbProfile.id,
      userId: dbProfile.userId,
      height: dbProfile.height ?? undefined,
      weight: dbProfile.weight ?? undefined,
      age: dbProfile.age ?? undefined,
      gender: dbProfile.gender ?? undefined,
      goals: dbProfile.goals ?? undefined,
      fitnessLevel: dbProfile.fitnessLevel ?? undefined,
      limitations: dbProfile.limitations ?? undefined,
      medicalNotes: dbProfile.medicalNotes ?? undefined,
      environment: dbProfile.environment ?? undefined,
      equipment: dbProfile.equipment ?? undefined,
      otherEquipment: dbProfile.otherEquipment ?? undefined,
      preferredStyles: dbProfile.preferredStyles ?? undefined,
      availableDays: dbProfile.availableDays ?? undefined,
      workoutDuration: dbProfile.workoutDuration ?? undefined,
      intensityLevel: dbProfile.intensityLevel ?? undefined,
      includeWarmup: dbProfile.includeWarmup ?? true,
      includeCooldown: dbProfile.includeCooldown ?? true,
      timezone: dbProfile.timezone ?? undefined,
      created_at: dbProfile.updatedAt ?? new Date(),
      updated_at: dbProfile.updatedAt ?? new Date(),
    };
    // Get current user to check if onboarding is being completed
    const currentUser = await userService.getUser(requestBody.userId!);

    // Update user to set needsOnboarding = false after profile creation
    await userService.updateUser(requestBody.userId!, {
      needsOnboarding: false,
    });

    // On first completion, sync the people-profile enrichment. NOTE: the
    // `onboarding_completed` EVENT is owned by the CLIENT (frontend
    // lib/analytics-events.ts) — the backend only updates the profile here, it no
    // longer emits a duplicate completion event.
    if (currentUser?.needsOnboarding === true && currentUser.uuid) {
      const clientIP = getClientIP(request);
      // Clear profile cache to ensure updated profile gets synced
      eventTrackingService.clearProfileCache(currentUser.uuid);
      // Update user profile with onboarding completion status
      await eventTrackingService.updateUserProfile(currentUser.uuid, {
        onboarding_complete: true,
      }, clientIP);
      this.notifyOwnerOfNewUser(currentUser.id);
    }

    // Get the updated user with needsOnboarding: false
    const updatedUser = await userService.getUser(requestBody.userId!);

    return {
      success: true,
      profile,
      user: updatedUser,
      needsOnboarding: false,
    };
  }

  /**
   * Update the user's profile
   */
  @Put("/{id}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async updateProfile(
    @Path() id: number,
    @Body() requestBody: Partial<Profile>,
    @Request() request: any
  ): Promise<ProfileResponse> {
    // Only include fields that are explicitly provided in the request
    const updateData: any = {
      id,
      userId: requestBody.userId!,
      updatedAt: new Date(),
    };

    // Only add fields that are explicitly provided (not undefined)
    if (requestBody.height !== undefined) updateData.height = requestBody.height;
    if (requestBody.weight !== undefined) updateData.weight = requestBody.weight;
    if (requestBody.age !== undefined) updateData.age = requestBody.age;
    if (requestBody.gender !== undefined) updateData.gender = requestBody.gender;
    if (requestBody.goals !== undefined) updateData.goals = requestBody.goals;
    if (requestBody.fitnessLevel !== undefined) updateData.fitnessLevel = requestBody.fitnessLevel;
    if (requestBody.limitations !== undefined) updateData.limitations = requestBody.limitations;
    if (requestBody.medicalNotes !== undefined) updateData.medicalNotes = requestBody.medicalNotes;
    if (requestBody.environment !== undefined) updateData.environment = requestBody.environment;
    if (requestBody.equipment !== undefined) updateData.equipment = requestBody.equipment;
    if (requestBody.otherEquipment !== undefined) updateData.otherEquipment = requestBody.otherEquipment;
    if (requestBody.preferredStyles !== undefined) updateData.preferredStyles = requestBody.preferredStyles;
    if (requestBody.availableDays !== undefined) updateData.availableDays = requestBody.availableDays;
    if (requestBody.workoutDuration !== undefined) updateData.workoutDuration = requestBody.workoutDuration;
    if (requestBody.intensityLevel !== undefined) updateData.intensityLevel = requestBody.intensityLevel;
    if (requestBody.includeWarmup !== undefined) updateData.includeWarmup = requestBody.includeWarmup;
    if (requestBody.includeCooldown !== undefined) updateData.includeCooldown = requestBody.includeCooldown;
    if (requestBody.timezone !== undefined) updateData.timezone = requestBody.timezone;

    const dbProfile = await profileService.createOrUpdateProfile(updateData);

    // The completion side-effects key off the PROFILE ROW's owner, never the
    // `requestBody.userId || id` fallback: `id` here is the profile row id, and
    // when the body omits userId the two drift apart — flipping the flag and
    // firing the once-ever new-user alert for whoever happens to hold that USER
    // id. dbProfile.userId is authoritative (and ownership-checked upstream).
    const targetUserId = dbProfile.userId;
    const currentUser = await userService.getUser(targetUserId);

    // Update user to set needsOnboarding = false after profile creation/update
    await userService.updateUser(targetUserId, {
      needsOnboarding: false,
    });

    // On first completion, sync the people-profile enrichment. NOTE: the
    // `onboarding_completed` EVENT is owned by the CLIENT (frontend
    // lib/analytics-events.ts) — the backend only updates the profile here, it no
    // longer emits a duplicate completion event.
    if (currentUser?.needsOnboarding === true && currentUser.uuid) {
      const clientIP = getClientIP(request);
      // Clear profile cache to ensure updated profile gets synced
      eventTrackingService.clearProfileCache(currentUser.uuid);
      // Update user profile with onboarding completion status
      await eventTrackingService.updateUserProfile(currentUser.uuid, {
        onboarding_complete: true,
      }, clientIP);
      this.notifyOwnerOfNewUser(currentUser.id);
    }

    // Get the updated user with needsOnboarding: false
    const updatedUser = await userService.getUser(targetUserId);

    const profile: Profile = {
      id: dbProfile.id,
      userId: dbProfile.userId,
      height: dbProfile.height ?? undefined,
      weight: dbProfile.weight ?? undefined,
      age: dbProfile.age ?? undefined,
      gender: dbProfile.gender ?? undefined,
      goals: dbProfile.goals ?? undefined,
      fitnessLevel: dbProfile.fitnessLevel ?? undefined,
      limitations: dbProfile.limitations ?? undefined,
      medicalNotes: dbProfile.medicalNotes ?? undefined,
      environment: dbProfile.environment ?? undefined,
      equipment: dbProfile.equipment ?? undefined,
      otherEquipment: dbProfile.otherEquipment ?? undefined,
      preferredStyles: dbProfile.preferredStyles ?? undefined,
      availableDays: dbProfile.availableDays ?? undefined,
      workoutDuration: dbProfile.workoutDuration ?? undefined,
      intensityLevel: dbProfile.intensityLevel ?? undefined,
      includeWarmup: dbProfile.includeWarmup ?? true,
      includeCooldown: dbProfile.includeCooldown ?? true,
      created_at: dbProfile.updatedAt ?? new Date(),
      updated_at: dbProfile.updatedAt ?? new Date(),
    };
    return {
      success: true,
      profile,
    };
  }

  /**
   * Update the user's profile by userId
   */
  @Put("/user/{userId}")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async updateProfileByUserId(
    @Path() userId: number,
    @Body() requestBody: Partial<Profile>,
    @Request() request: any
  ): Promise<ProfileResponse> {
    // Only include fields that are explicitly provided in the request
    const updateData: any = {
      userId,
      updatedAt: new Date(),
    };

    // Only add fields that are explicitly provided (not undefined)
    if (requestBody.height !== undefined) updateData.height = requestBody.height;
    if (requestBody.weight !== undefined) updateData.weight = requestBody.weight;
    if (requestBody.age !== undefined) updateData.age = requestBody.age;
    if (requestBody.gender !== undefined) updateData.gender = requestBody.gender;
    if (requestBody.goals !== undefined) updateData.goals = requestBody.goals;
    if (requestBody.fitnessLevel !== undefined) updateData.fitnessLevel = requestBody.fitnessLevel;
    if (requestBody.limitations !== undefined) updateData.limitations = requestBody.limitations;
    if (requestBody.medicalNotes !== undefined) updateData.medicalNotes = requestBody.medicalNotes;
    if (requestBody.environment !== undefined) updateData.environment = requestBody.environment;
    if (requestBody.equipment !== undefined) updateData.equipment = requestBody.equipment;
    if (requestBody.otherEquipment !== undefined) updateData.otherEquipment = requestBody.otherEquipment;
    if (requestBody.preferredStyles !== undefined) updateData.preferredStyles = requestBody.preferredStyles;
    if (requestBody.availableDays !== undefined) updateData.availableDays = requestBody.availableDays;
    if (requestBody.workoutDuration !== undefined) updateData.workoutDuration = requestBody.workoutDuration;
    if (requestBody.intensityLevel !== undefined) updateData.intensityLevel = requestBody.intensityLevel;
    if (requestBody.includeWarmup !== undefined) updateData.includeWarmup = requestBody.includeWarmup;
    if (requestBody.includeCooldown !== undefined) updateData.includeCooldown = requestBody.includeCooldown;
    if (requestBody.timezone !== undefined) updateData.timezone = requestBody.timezone;

    const dbProfile = await profileService.createOrUpdateProfile(updateData);

    // Get current user to check if onboarding is being completed
    const currentUser = await userService.getUser(userId);

    // Update user to set needsOnboarding = false after profile creation/update
    await userService.updateUser(userId, {
      needsOnboarding: false,
    });

    // On first completion, sync the people-profile enrichment. NOTE: the
    // `onboarding_completed` EVENT is owned by the CLIENT (frontend
    // lib/analytics-events.ts) — the backend only updates the profile here, it no
    // longer emits a duplicate completion event.
    if (currentUser?.needsOnboarding === true && currentUser.uuid) {
      const clientIP = getClientIP(request);
      // Clear profile cache to ensure updated profile gets synced
      eventTrackingService.clearProfileCache(currentUser.uuid);
      // Update user profile with onboarding completion status
      await eventTrackingService.updateUserProfile(currentUser.uuid, {
        onboarding_complete: true,
      }, clientIP);
      this.notifyOwnerOfNewUser(currentUser.id);
    }

    // Get the updated user with needsOnboarding: false
    const updatedUser = await userService.getUser(userId);

    const profile: Profile = {
      id: dbProfile.id,
      userId: dbProfile.userId,
      height: dbProfile.height ?? undefined,
      weight: dbProfile.weight ?? undefined,
      age: dbProfile.age ?? undefined,
      gender: dbProfile.gender ?? undefined,
      goals: dbProfile.goals ?? undefined,
      fitnessLevel: dbProfile.fitnessLevel ?? undefined,
      limitations: dbProfile.limitations ?? undefined,
      medicalNotes: dbProfile.medicalNotes ?? undefined,
      environment: dbProfile.environment ?? undefined,
      equipment: dbProfile.equipment ?? undefined,
      otherEquipment: dbProfile.otherEquipment ?? undefined,
      preferredStyles: dbProfile.preferredStyles ?? undefined,
      availableDays: dbProfile.availableDays ?? undefined,
      workoutDuration: dbProfile.workoutDuration ?? undefined,
      intensityLevel: dbProfile.intensityLevel ?? undefined,
      includeWarmup: dbProfile.includeWarmup ?? true,
      includeCooldown: dbProfile.includeCooldown ?? true,
      created_at: dbProfile.updatedAt ?? new Date(),
      updated_at: dbProfile.updatedAt ?? new Date(),
    };
    return {
      success: true,
      profile,
      user: updatedUser,
      needsOnboarding: false,
    };
  }

  /**
   * Update the user's display name (fix-a-typo affordance in Account).
   * Deliberately name-only: email is immutable from the app.
   */
  @Put("/user/{userId}/name")
  @Response<ApiResponse>(400, "Bad Request")
  @SuccessResponse(200, "Success")
  public async updateUserName(
    @Path() userId: number,
    @Body() requestBody: { name: string }
  ): Promise<ApiResponse & { name?: string }> {
    const name = (requestBody.name ?? "").trim();
    if (!name) {
      return { success: false, error: "Name cannot be empty" };
    }
    if (name.length > 80) {
      return { success: false, error: "Name must be 80 characters or fewer" };
    }
    const updated = await userService.updateUser(userId, { name });
    return { success: true, name: updated.name };
  }
}

export const profileController = new ProfileController();
