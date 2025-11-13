import { eq, and, lt } from "drizzle-orm";
import { randomBytes, createHash } from "crypto";
import { db } from "@/config/database";
import { refreshTokens, InsertRefreshToken, RefreshToken } from "@/models";
import { logger } from "@/utils/logger";

export class RefreshTokenService {
  private readonly REFRESH_TOKEN_LENGTH = 64;
  private readonly REFRESH_TOKEN_EXPIRY_DAYS = 30;

  /**
   * Generate a secure random refresh token
   */
  private generateToken(): string {
    return randomBytes(this.REFRESH_TOKEN_LENGTH).toString("hex");
  }

  /**
   * Hash a token for secure storage
   */
  private hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  /**
   * Create a new refresh token for a user
   */
  async createRefreshToken(userId: number): Promise<string> {
    try {
      // Clean up any expired tokens for this user
      await this.cleanupExpiredTokens();

      // Generate a new token
      const token = this.generateToken();
      const tokenHash = this.hashToken(token);

      // Calculate expiry date
      const expiresAt = new Date();
      expiresAt.setDate(expiresAt.getDate() + this.REFRESH_TOKEN_EXPIRY_DAYS);

      // Store the hashed token in database
      await db.insert(refreshTokens).values({
        userId,
        tokenHash,
        expiresAt,
      });

      logger.info("Refresh token created", {
        operation: "createRefreshToken",
        metadata: { userId, expiresAt: expiresAt.toISOString() },
      });

      return token;
    } catch (error) {
      logger.error("Failed to create refresh token", error as Error, {
        operation: "createRefreshToken",
        metadata: { userId },
      });
      throw new Error("Failed to create refresh token");
    }
  }

  /**
   * Validate a refresh token and return the associated user ID
   */
  async validateRefreshToken(token: string): Promise<number | null> {
    try {
      const tokenHash = this.hashToken(token);

      const result = await db
        .select()
        .from(refreshTokens)
        .where(
          and(
            eq(refreshTokens.tokenHash, tokenHash),
            eq(refreshTokens.isRevoked, false)
          )
        )
        .limit(1);

      if (result.length === 0) {
        logger.warn("Invalid refresh token attempted", {
          operation: "validateRefreshToken",
          metadata: { tokenHash: tokenHash.substring(0, 8) + "..." },
        });
        return null;
      }

      const refreshToken = result[0];

      // Check if token is expired
      if (refreshToken.expiresAt < new Date()) {
        logger.warn("Expired refresh token attempted", {
          operation: "validateRefreshToken",
          metadata: {
            userId: refreshToken.userId,
            expiresAt: refreshToken.expiresAt.toISOString(),
          },
        });
        return null;
      }

      logger.info("Refresh token validated successfully", {
        operation: "validateRefreshToken",
        metadata: { userId: refreshToken.userId },
      });

      return refreshToken.userId;
    } catch (error) {
      logger.error("Failed to validate refresh token", error as Error, {
        operation: "validateRefreshToken",
      });
      return null;
    }
  }

  /**
   * Revoke a specific refresh token
   */
  async revokeRefreshToken(token: string): Promise<boolean> {
    try {
      const tokenHash = this.hashToken(token);

      const result = await db
        .update(refreshTokens)
        .set({ isRevoked: true })
        .where(eq(refreshTokens.tokenHash, tokenHash));

      logger.info("Refresh token revoked", {
        operation: "revokeRefreshToken",
        metadata: { tokenHash: tokenHash.substring(0, 8) + "..." },
      });

      return true;
    } catch (error) {
      logger.error("Failed to revoke refresh token", error as Error, {
        operation: "revokeRefreshToken",
      });
      return false;
    }
  }

  /**
   * Revoke all refresh tokens for a user (useful for logout)
   */
  async revokeAllUserTokens(userId: number): Promise<boolean> {
    try {
      await db
        .update(refreshTokens)
        .set({ isRevoked: true })
        .where(eq(refreshTokens.userId, userId));

      logger.info("All refresh tokens revoked for user", {
        operation: "revokeAllUserTokens",
        metadata: { userId },
      });

      return true;
    } catch (error) {
      logger.error("Failed to revoke all user tokens", error as Error, {
        operation: "revokeAllUserTokens",
        metadata: { userId },
      });
      return false;
    }
  }

  /**
   * Rotate a refresh token (revoke old, create new)
   */
  async rotateRefreshToken(oldToken: string): Promise<string | null> {
    try {
      const userId = await this.validateRefreshToken(oldToken);

      if (!userId) {
        return null;
      }

      // Revoke the old token
      await this.revokeRefreshToken(oldToken);

      // Create a new token
      const newToken = await this.createRefreshToken(userId);

      logger.info("Refresh token rotated", {
        operation: "rotateRefreshToken",
        metadata: { userId },
      });

      return newToken;
    } catch (error) {
      logger.error("Failed to rotate refresh token", error as Error, {
        operation: "rotateRefreshToken",
      });
      return null;
    }
  }

  /**
   * Clean up expired tokens (should be run periodically)
   */
  async cleanupExpiredTokens(): Promise<void> {
    try {
      const result = await db
        .delete(refreshTokens)
        .where(lt(refreshTokens.expiresAt, new Date()));

      logger.info("Expired refresh tokens cleaned up", {
        operation: "cleanupExpiredTokens",
      });
    } catch (error) {
      logger.error("Failed to cleanup expired tokens", error as Error, {
        operation: "cleanupExpiredTokens",
      });
    }
  }

  /**
   * Get refresh token statistics for monitoring
   */
  async getTokenStats(): Promise<{
    total: number;
    active: number;
    expired: number;
    revoked: number;
  }> {
    try {
      const allTokens = await db.select().from(refreshTokens);
      const now = new Date();

      const stats = {
        total: allTokens.length,
        active: 0,
        expired: 0,
        revoked: 0,
      };

      allTokens.forEach((token) => {
        if (token.isRevoked) {
          stats.revoked++;
        } else if (token.expiresAt < now) {
          stats.expired++;
        } else {
          stats.active++;
        }
      });

      return stats;
    } catch (error) {
      logger.error("Failed to get token stats", error as Error);
      return { total: 0, active: 0, expired: 0, revoked: 0 };
    }
  }
}

export const refreshTokenService = new RefreshTokenService();