import Mixpanel from "mixpanel";
import { logger } from "@/utils/logger";

export interface UserProfileProperties {
  // Basic user info
  $email: string;
  $name: string;
  $created: Date;

  // Demographics
  age?: number;
  gender?: "male" | "female" | "other";

  // Onboarding status
  onboarding_complete?: boolean;

  // Fitness profile
  fitness_level?: "beginner" | "intermediate" | "advanced" | "expert";
  primary_goals?: string[];
  physical_limitations?: string[];
  workout_environment?: "home" | "gym" | "outdoor" | "mixed";
  available_equipment?: string[];
  preferred_workout_styles?: string[];
  preferred_workout_days?: string[];
  workout_intensity_preference?: "low" | "moderate" | "high" | "variable";
}

export interface EventProperties {
  [key: string]: string | number | boolean | Date | string[] | undefined;
}

/**
 * Mixpanel Analytics Service
 * Server-side dominant approach for reliable event tracking
 */
export class MixpanelService {
  private client: Mixpanel.Mixpanel | null = null;
  private isEnabled: boolean;

  constructor() {
    const token = process.env.MIXPANEL_TOKEN;
    this.isEnabled = process.env.NODE_ENV === "production" && !!token;

    if (this.isEnabled && token) {
      this.client = Mixpanel.init(token, {
        debug: process.env.NODE_ENV === "development",
        protocol: "https",
      });
      logger.info("Mixpanel service initialized", {
        environment: process.env.NODE_ENV,
        enabled: this.isEnabled,
      });
    } else {
      logger.info("Mixpanel service disabled", {
        environment: process.env.NODE_ENV,
        hasToken: !!token,
      });
    }
  }

  /**
   * Check if Mixpanel is healthy and operational
   */
  isHealthy(): boolean {
    return this.isEnabled && this.client !== null;
  }

  /**
   * Identify user in Mixpanel (associates UUID with user profile)
   */
  async identify(userUuid: string, ip?: string): Promise<void> {
    if (!this.isEnabled || !this.client) {
      logger.debug("Mixpanel user identification skipped (disabled)", {
        operation: "identify",
      });
      return;
    }

    try {
      const identifyData: Record<string, any> = {
        distinct_id: userUuid,
      };

      // Include IP for geolocation if provided
      if (ip) {
        identifyData.$ip = ip;
      }

      await new Promise<void>((resolve, reject) => {
        this.client!.people.set(userUuid, identifyData, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      logger.debug("User identified in Mixpanel", {
        operation: "identify",
        userUuid: userUuid.substring(0, 8) + "...", // Log partial UUID for privacy
        hasIP: !!ip,
        ipPreview: ip ? ip.substring(0, 8) + "..." : undefined,
      });
    } catch (error) {
      logger.error("Mixpanel user identification failed", error as Error, {
        operation: "identify",
        userUuid: userUuid.substring(0, 8) + "...",
      });
      // Don't throw error to prevent disrupting main application flow
    }
  }

  /**
   * Create or update user profile in Mixpanel
   */
  async setUserProfile(
    userUuid: string,
    properties: Partial<UserProfileProperties> & Record<string, any>,
    ip?: string
  ): Promise<void> {
    if (!this.isEnabled || !this.client) {
      logger.debug("Mixpanel profile update skipped (disabled)", {
        operation: "setUserProfile",
      });
      return;
    }

    try {
      // Sanitize properties for Mixpanel
      const sanitizedProperties = this.sanitizeProperties(properties);

      // Include IP for geolocation if provided
      if (ip) {
        sanitizedProperties.$ip = ip;
      }

      await new Promise<void>((resolve, reject) => {
        this.client!.people.set(userUuid, sanitizedProperties, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      logger.debug("Mixpanel profile updated", { operation: "setUserProfile" });
    } catch (error) {
      logger.error("Mixpanel profile update failed", error as Error, {
        operation: "setUserProfile",
      });
      // Don't throw error to prevent disrupting main application flow
    }
  }

  /**
   * Track an event with properties
   */
  async track(
    userUuid: string,
    eventName: string,
    properties: EventProperties = {},
    ip?: string
  ): Promise<void> {
    if (!this.isEnabled || !this.client) {
      logger.debug("Mixpanel event tracking skipped (disabled)", {
        operation: "track",
      });
      return;
    }

    try {
      const eventData: Record<string, any> = {
        distinct_id: userUuid,
        time: new Date(),
        ...this.sanitizeProperties(properties),
      };

      // Include IP for geolocation if provided
      if (ip) {
        eventData.ip = ip;
      }

      await new Promise<void>((resolve, reject) => {
        this.client!.track(eventName, eventData, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      logger.debug("Mixpanel event tracked", {
        operation: "track",
        metadata: {
          eventName,
          propertiesCount: Object.keys(properties).length,
          hasIP: !!ip,
          ipPreview: ip ? ip.substring(0, 8) + "..." : undefined,
        },
      });
    } catch (error) {
      logger.error("Mixpanel event tracking failed", error as Error, {
        operation: "track",
        metadata: { eventName },
      });
      // Don't throw error to prevent disrupting main application flow
    }
  }

  /**
   * Delete user profile (for GDPR compliance)
   */
  async deleteUser(userUuid: string): Promise<void> {
    if (!this.isEnabled || !this.client) {
      logger.debug("Mixpanel delete user skipped (disabled)", {
        operation: "deleteUser",
      });
      return;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        this.client!.people.delete_user(userUuid, (err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      });

      logger.info("Mixpanel user deleted", { operation: "deleteUser" });
    } catch (error) {
      logger.error("Mixpanel user deletion failed", error as Error, {
        operation: "deleteUser",
      });
      throw error; // Re-throw for GDPR compliance requirements
    }
  }

  /**
   * Sanitize properties for Mixpanel compatibility
   * - Remove undefined values
   * - Convert dates to ISO strings
   * - Ensure proper types
   * - Remove potentially sensitive data
   */
  private sanitizeProperties(
    properties: Record<string, any>
  ): Record<string, any> {
    const sanitized: Record<string, any> = {};

    for (const [key, value] of Object.entries(properties)) {
      // Skip undefined values
      if (value === undefined || value === null) {
        continue;
      }

      // Convert dates to ISO strings
      if (value instanceof Date) {
        sanitized[key] = value.toISOString();
        continue;
      }

      // Convert arrays to proper format
      if (Array.isArray(value)) {
        sanitized[key] = value;
        continue;
      }

      // Ensure string/number/boolean types
      if (
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean"
      ) {
        sanitized[key] = value;
        continue;
      }

      // Convert objects to JSON strings if needed
      if (typeof value === "object") {
        try {
          sanitized[key] = JSON.stringify(value);
        } catch {
          // Skip objects that can't be serialized
          logger.warn("Failed to serialize property for Mixpanel", {
            operation: "sanitizeProperties",
            metadata: { propertyKey: key, type: typeof value },
          });
        }
        continue;
      }

      // Log unexpected types
      logger.warn("Unexpected property type for Mixpanel", {
        operation: "sanitizeProperties",
        metadata: {
          propertyKey: key,
          type: typeof value,
          sampleValue: String(value).substring(0, 100),
        },
      });
    }

    return sanitized;
  }
}

// Export singleton instance
export const mixpanelService = new MixpanelService();
