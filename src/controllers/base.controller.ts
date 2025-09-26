import { Controller } from "@tsoa/runtime";
import { validateCurrentWaiver, WaiverValidationError } from "@/utils/waiver.utils";

/**
 * Base controller that provides waiver validation for all TSOA controllers
 * Extend this class instead of Controller directly
 */
export class BaseController extends Controller {
  /**
   * Validates that the authenticated user has accepted the current waiver version
   * Call this at the beginning of any method that requires waiver compliance
   *
   * @param request - TSOA request object containing userId
   * @param route - Optional route identifier for logging
   * @throws WaiverValidationError (HTTP 426) if waiver is outdated
   */
  protected async validateWaiver(request: any, route?: string): Promise<void> {
    await validateCurrentWaiver(request.userId, route);
  }

  /**
   * Helper method to get authenticated user ID from request
   * @param request - TSOA request object
   * @returns User ID from JWT token
   */
  protected getAuthenticatedUserId(request: any): number {
    if (!request.userId) {
      throw new Error("User not authenticated");
    }
    return request.userId;
  }
}