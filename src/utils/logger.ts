export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3,
}

interface LogContext {
  requestId?: string;
  userId?: number;
  operation?: string;
  userAgent?: string;
  ip?: string;
  path?: string;
  method?: string;
  duration?: number;
  responseSize?: string;
  metadata?: Record<string, any>;
  error?: string;
  query?: any;
  timestamp?: string;
  hasBody?: boolean;
  bodyKeys?: string[];
  body?: any;
  response?: any;
  errorType?: string;
  errorMessage?: string;
  stack?: string;
  validationIssues?: any;
  statusCode?: number;
  routeName?: string;
  hasAuthHeader?: boolean;
  authType?: string;
  clientIP?: string;
  headers?: any;
  bodySize?: number;
  url?: string;
}

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  context?: LogContext;
  error?: {
    message: string;
    stack?: string;
    code?: string;
  };
}

class Logger {
  private currentLevel: LogLevel;
  private context: LogContext = {};

  constructor() {
    // Set log level based on environment
    const envLevel = process.env.LOG_LEVEL?.toUpperCase();
    switch (envLevel) {
      case "ERROR":
        this.currentLevel = LogLevel.ERROR;
        break;
      case "WARN":
        this.currentLevel = LogLevel.WARN;
        break;
      case "INFO":
        this.currentLevel = LogLevel.INFO;
        break;
      case "DEBUG":
        this.currentLevel = LogLevel.DEBUG;
        break;
      default:
        this.currentLevel =
          process.env.NODE_ENV === "production"
            ? LogLevel.INFO
            : LogLevel.DEBUG;
    }
  }

  setContext(context: Partial<LogContext>) {
    this.context = { ...this.context, ...context };
  }

  clearContext() {
    this.context = {};
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.currentLevel;
  }

  private formatLog(
    level: string,
    message: string,
    context?: LogContext,
    error?: Error
  ): LogEntry {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
    };

    if (context || this.context) {
      logEntry.context = { ...this.context, ...context };
    }

    if (error) {
      logEntry.error = {
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
      };
    }

    return logEntry;
  }

  private writeLog(logEntry: LogEntry) {
    const output = JSON.stringify(logEntry);

    if (logEntry.level === "ERROR") {
      console.error(output);
    } else if (logEntry.level === "WARN") {
      console.warn(output);
    } else {
      console.log(output);
    }
  }

  error(message: string, error?: Error, context?: LogContext) {
    if (!this.shouldLog(LogLevel.ERROR)) return;

    const logEntry = this.formatLog("ERROR", message, context, error);
    this.writeLog(logEntry);
  }

  warn(message: string, context?: LogContext) {
    if (!this.shouldLog(LogLevel.WARN)) return;

    const logEntry = this.formatLog("WARN", message, context);
    this.writeLog(logEntry);
  }

  info(message: string, context?: LogContext) {
    if (!this.shouldLog(LogLevel.INFO)) return;

    const logEntry = this.formatLog("INFO", message, context);
    this.writeLog(logEntry);
  }

  debug(message: string, context?: LogContext) {
    if (!this.shouldLog(LogLevel.DEBUG)) return;

    const logEntry = this.formatLog("DEBUG", message, context);
    this.writeLog(logEntry);
  }

  // Utility methods for common scenarios
  requestStart(method: string, path: string, context?: LogContext) {
    this.info(`${method} ${path} - Request started`, context);
  }

  requestEnd(
    method: string,
    path: string,
    statusCode: number,
    duration: number,
    context?: LogContext
  ) {
    const level =
      statusCode >= 400 ? "ERROR" : statusCode >= 300 ? "WARN" : "INFO";
    const message = `${method} ${path} - ${statusCode} (${duration}ms)`;

    if (level === "ERROR") {
      this.error(message, undefined, context);
    } else if (level === "WARN") {
      this.warn(message, context);
    } else {
      this.info(message, context);
    }
  }

  operationStart(operation: string, context?: LogContext) {
    this.debug(`Operation started: ${operation}`, context);
  }

  operationEnd(
    operation: string,
    success: boolean,
    duration: number,
    context?: LogContext
  ) {
    const message = `Operation ${success ? "completed" : "failed"}: ${operation} (${duration}ms)`;

    if (success) {
      this.info(message, context);
    } else {
      this.error(message, undefined, context);
    }
  }

  securityEvent(event: string, context?: LogContext) {
    this.warn(`Security event: ${event}`, context);
  }

  performanceWarning(
    operation: string,
    duration: number,
    threshold: number,
    context?: LogContext
  ) {
    this.warn(
      `Performance warning: ${operation} took ${duration}ms (threshold: ${threshold}ms)`,
      context
    );
  }
}

// Create singleton instance
export const logger = new Logger();

// Legacy support - will be removed after migration
export const log = (message: string) => {
  logger.info(message);
};
