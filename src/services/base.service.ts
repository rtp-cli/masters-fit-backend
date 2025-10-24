import { db } from '@/config/database.js';
import { eq } from 'drizzle-orm';
import { retryWithBackoff, DEFAULT_API_RETRY_OPTIONS, RetryOptions } from '@/utils/retry.utils.js';
import { logger } from '@/utils/logger.js';

// Database-specific retry options - more aggressive for connection issues
const DATABASE_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelay: 2000, // 2 seconds
  maxDelay: 15000, // 15 seconds
  backoffMultiplier: 2
};

export class BaseService {
  protected db = db;
  protected eq = eq;

  /**
   * Check if an error is a transient database connection error that should be retried
   */
  private isRetriableDbError(error: any): boolean {
    const retriableErrors = [
      'ECONNRESET',
      'ECONNREFUSED',
      'ENOTFOUND',
      'EADDRNOTAVAIL',
      'ETIMEDOUT',
      'EPIPE',
      'connection timeout',
      'server closed the connection',
      'Connection terminated unexpectedly'
    ];

    const errorMessage = error.message?.toLowerCase() || '';
    const errorCode = error.code?.toUpperCase() || '';

    return retriableErrors.some(code =>
      errorMessage.includes(code.toLowerCase()) ||
      errorCode === code.toUpperCase()
    );
  }

  /**
   * Execute a database operation with retry logic for connection failures
   */
  protected async executeWithRetry<T>(
    operation: () => Promise<T>,
    context: { operation: string; userId?: number },
    customRetryOptions?: Partial<RetryOptions>
  ): Promise<T> {
    const options = { ...DATABASE_RETRY_OPTIONS, ...customRetryOptions };

    return retryWithBackoff(
      async () => {
        try {
          return await operation();
        } catch (error) {
          // Log the original error for debugging
          logger.debug(`Database operation failed: ${context.operation}`, {
            operation: context.operation,
            userId: context.userId,
            metadata: {
              error: error.message,
              code: error.code,
              retriable: this.isRetriableDbError(error)
            }
          });

          // Only retry if it's a retriable error
          if (this.isRetriableDbError(error)) {
            throw error; // This will trigger the retry logic
          } else {
            // For non-retriable errors (like constraint violations), fail immediately
            logger.error(`Non-retriable database error in ${context.operation}`, error, {
              operation: context.operation,
              userId: context.userId
            });
            throw error;
          }
        }
      },
      options,
      context
    );
  }

  /**
   * Helper method for SELECT operations with retry
   */
  protected async selectWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    userId?: number
  ): Promise<T> {
    return this.executeWithRetry(
      operation,
      { operation: `SELECT: ${operationName}`, userId }
    );
  }

  /**
   * Helper method for INSERT operations with retry
   */
  protected async insertWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    userId?: number
  ): Promise<T> {
    return this.executeWithRetry(
      operation,
      { operation: `INSERT: ${operationName}`, userId },
      { maxAttempts: 2 } // Fewer retries for inserts to avoid duplicates
    );
  }

  /**
   * Helper method for UPDATE operations with retry
   */
  protected async updateWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    userId?: number
  ): Promise<T> {
    return this.executeWithRetry(
      operation,
      { operation: `UPDATE: ${operationName}`, userId },
      { maxAttempts: 2 } // Fewer retries for updates
    );
  }

  /**
   * Helper method for DELETE operations with retry
   */
  protected async deleteWithRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    userId?: number
  ): Promise<T> {
    return this.executeWithRetry(
      operation,
      { operation: `DELETE: ${operationName}`, userId },
      { maxAttempts: 2 } // Fewer retries for deletes
    );
  }
} 