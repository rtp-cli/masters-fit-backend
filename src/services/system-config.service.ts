import { BaseService } from "./base.service";
import { systemConfig, SYSTEM_CONFIG_KEY, TestEmailConfig, VersionConfig } from "@/models";
import type { SystemConfig } from "@/models";
import { eq } from "drizzle-orm";
import { logger } from "@/utils/logger";
import { redisClient } from "@/utils/redis";

const CACHE_TTL = 300; // 5 minutes cache TTL

export class SystemConfigService extends BaseService {
  /**
   * Get config value by key
   * @param key System config key
   * @returns Config value or null if not found
   */
  async getConfig(key: typeof SYSTEM_CONFIG_KEY[keyof typeof SYSTEM_CONFIG_KEY]): Promise<SystemConfig | null> {
    const cacheKey = `system_config:${key}`;

    try {
      // Try to get from cache first
      if (redisClient.isOpen) {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          return JSON.parse(cached);
        }
      }
    } catch (error) {
      logger.debug("Redis cache miss or error, fetching from database", {
        operation: "getConfig",
        metadata: { key },
      });
    }

    try {
      const result = await this.selectWithRetry(
        async () => {
          return await this.db
            .select()
            .from(systemConfig)
            .where(eq(systemConfig.key, key))
            .limit(1);
        },
        `getConfig:${key}`
      );

      const config = result[0] || null;

      // Cache the result if Redis is available
      if (config && redisClient.isOpen) {
        try {
          await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(config));
        } catch (error) {
          logger.debug("Failed to cache system config", {
            operation: "getConfig",
            metadata: { key },
          });
        }
      }

      return config;
    } catch (error) {
      logger.error("Failed to get system config", error as Error, {
        operation: "getConfig",
        metadata: { key },
      });
      return null;
    }
  }

  /**
   * Get test emails from system config
   * @returns Array of test email addresses
   */
  async getTestEmails(): Promise<string[]> {
    const config = await this.getConfig(SYSTEM_CONFIG_KEY.TEST_EMAIL);
    
    if (!config || !config.value) {
      return [];
    }

    try {
      const testEmailConfig = config.value as TestEmailConfig;
      return testEmailConfig.emails || [];
    } catch (error) {
      logger.error("Failed to parse test email config", error as Error, {
        operation: "getTestEmails",
      });
      return [];
    }
  }

  /**
   * Check if an email is in the test email list
   * @param email Email address to check
   * @returns True if email is in test email list
   */
  async isTestEmail(email: string): Promise<boolean> {
    const testEmails = await this.getTestEmails();
    return testEmails.includes(email.toLowerCase());
  }

  /**
   * Get force update version from system config
   * @returns Version string or null
   */
  async getForceUpdateVersion(): Promise<string | null> {
    const config = await this.getConfig(SYSTEM_CONFIG_KEY.FORCE_UPDATE_VERSION);
    
    if (!config || !config.value) {
      return null;
    }

    try {
      const versionConfig = config.value as VersionConfig;
      return versionConfig.version || null;
    } catch (error) {
      logger.error("Failed to parse force update version config", error as Error, {
        operation: "getForceUpdateVersion",
      });
      return null;
    }
  }

  /**
   * Get soft update version from system config
   * @returns Version string or null
   */
  async getSoftUpdateVersion(): Promise<string | null> {
    const config = await this.getConfig(SYSTEM_CONFIG_KEY.SOFT_UPDATE_VERSION);
    
    if (!config || !config.value) {
      return null;
    }

    try {
      const versionConfig = config.value as VersionConfig;
      return versionConfig.version || null;
    } catch (error) {
      logger.error("Failed to parse soft update version config", error as Error, {
        operation: "getSoftUpdateVersion",
      });
      return null;
    }
  }

  /**
   * Invalidate cache for a specific config key
   * @param key System config key
   */
  async invalidateCache(key: typeof SYSTEM_CONFIG_KEY[keyof typeof SYSTEM_CONFIG_KEY]): Promise<void> {
    const cacheKey = `system_config:${key}`;
    
    if (redisClient.isOpen) {
      try {
        await redisClient.del(cacheKey);
      } catch (error) {
        logger.debug("Failed to invalidate cache", {
          operation: "invalidateCache",
          metadata: { key },
        });
      }
    }
  }
}

export const systemConfigService = new SystemConfigService();

