import { logger } from "./logger";

export interface RetryOptions {
  maxAttempts: number;
  baseDelay: number;
  maxDelay: number;
  backoffMultiplier: number;
}

export class RetryError extends Error {
  public readonly attempts: number;
  public readonly lastError: Error;

  constructor(attempts: number, lastError: Error) {
    super(`Failed after ${attempts} attempts: ${lastError.message}`);
    this.name = 'RetryError';
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

/**
 * Retry a function with exponential backoff
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options: RetryOptions,
  context?: { operation: string; userId?: number }
): Promise<T> {
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      
      if (attempt === options.maxAttempts) {
        logger.error(`Final retry attempt failed`, lastError, {
          operation: context?.operation || 'retryWithBackoff',
          userId: context?.userId,
          metadata: { attempts: attempt, maxAttempts: options.maxAttempts }
        });
        throw new RetryError(attempt, lastError);
      }
      
      // Calculate delay with exponential backoff
      const delay = Math.min(
        options.baseDelay * Math.pow(options.backoffMultiplier, attempt - 1),
        options.maxDelay
      );
      
      logger.warn(`Retry attempt ${attempt} failed, retrying in ${delay}ms`, {
        operation: context?.operation || 'retryWithBackoff',
        userId: context?.userId,
        metadata: { 
          attempt, 
          maxAttempts: options.maxAttempts, 
          delay,
          error: lastError.message 
        }
      });
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  // This should never be reached, but just in case
  throw new RetryError(options.maxAttempts, lastError!);
}

/**
 * Default retry options for API calls
 */
export const DEFAULT_API_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 10000, // 10 seconds
  backoffMultiplier: 2
};

/**
 * Retry options for chunked generation (shorter delays)
 */
export const CHUNKED_GENERATION_RETRY_OPTIONS: RetryOptions = {
  maxAttempts: 2,
  baseDelay: 500, // 0.5 seconds
  maxDelay: 2000, // 2 seconds
  backoffMultiplier: 2
};