import { profileService, userService } from "@/services";
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
} from "@tsoa/runtime";

@Route("profile")
@Tags("Profile")
@Security("bearerAuth")
export class ProfileController extends Controller {
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
    @Body() requestBody: Partial<Profile>
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
      created_at: dbProfile.updatedAt ?? new Date(),
      updated_at: dbProfile.updatedAt ?? new Date(),
    };
    // Update user to set needsOnboarding = false after profile creation
    await userService.updateUser(requestBody.userId!, {
      needsOnboarding: false,
    });

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
    @Body() requestBody: Partial<Profile>
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

    const dbProfile = await profileService.createOrUpdateProfile(updateData);

    // Update user to set needsOnboarding = false after profile creation/update
    await userService.updateUser(requestBody.userId || userId, {
      needsOnboarding: false,
    });

    // Get the updated user with needsOnboarding: false
    const updatedUser = await userService.getUser(requestBody.userId || userId);

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
    @Body() requestBody: Partial<Profile>
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

    const dbProfile = await profileService.createOrUpdateProfile(updateData);

    // Update user to set needsOnboarding = false after profile creation/update
    await userService.updateUser(userId, {
      needsOnboarding: false,
    });

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
}

export const profileController = new ProfileController();
