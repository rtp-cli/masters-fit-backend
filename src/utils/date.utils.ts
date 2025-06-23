/**
 * Centralized Date Utilities for Masters Fit Application
 *
 * This module provides standardized date handling to ensure:
 * 1. All dates are stored in UTC in the database
 * 2. All date comparisons use the same timezone
 * 3. Display dates are properly converted to local timezone
 * 4. Date filtering and queries are timezone-aware
 */

/**
 * Get current date in UTC as ISO string
 */
export function getCurrentUTCDate(): Date {
  return new Date();
}

/**
 * Get current date in YYYY-MM-DD format in UTC
 */
export function getCurrentDateString(): string {
  return new Date().toISOString().split("T")[0];
}

/**
 * Convert any date input to UTC Date object
 */
export function toUTCDate(dateInput: string | Date | null | undefined): Date {
  if (!dateInput) {
    return new Date();
  }

  if (typeof dateInput === "string") {
    // If it's just a date string (YYYY-MM-DD), treat as local date
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      return new Date(dateInput + "T00:00:00.000Z");
    }
    return new Date(dateInput);
  }

  return new Date(dateInput);
}

/**
 * Convert UTC date to local timezone for display
 */
export function toLocalDate(utcDate: Date | string | null | undefined): Date {
  if (!utcDate) {
    return new Date();
  }

  const date = typeof utcDate === "string" ? new Date(utcDate) : utcDate;
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000);
}

/**
 * Format date for display in local timezone
 */
export function formatDateForDisplay(
  dateInput: Date | string | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
  }
): string {
  if (!dateInput) {
    return "";
  }

  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

/**
 * Format date as YYYY-MM-DD string in local timezone
 */
export function formatDateAsString(
  dateInput: Date | string | null | undefined
): string {
  if (!dateInput) {
    return getCurrentDateString();
  }

  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return date.toISOString().split("T")[0];
}

/**
 * Format date as YYYY-MM-DD string in local timezone (for display)
 */
export function formatDateAsLocalString(
  dateInput: Date | string | null | undefined
): string {
  if (!dateInput) {
    return formatDateToString(new Date());
  }

  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return formatDateToString(date);
}

/**
 * Get start of day in UTC
 */
export function getStartOfDayUTC(dateInput?: Date | string): Date {
  const date = dateInput ? toUTCDate(dateInput) : new Date();
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  return startOfDay;
}

/**
 * Get end of day in UTC
 */
export function getEndOfDayUTC(dateInput?: Date | string): Date {
  const date = dateInput ? toUTCDate(dateInput) : new Date();
  const endOfDay = new Date(date);
  endOfDay.setUTCHours(23, 59, 59, 999);
  return endOfDay;
}

/**
 * Get date range for queries (start and end of day in UTC)
 */
export function getDateRangeUTC(
  startDate?: string | Date,
  endDate?: string | Date
): { start: Date; end: Date } {
  const end = endDate ? toUTCDate(endDate) : new Date();
  const start = startDate
    ? toUTCDate(startDate)
    : new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days ago

  return {
    start: getStartOfDayUTC(start),
    end: getEndOfDayUTC(end),
  };
}

/**
 * Check if two dates are the same day (in local timezone)
 */
export function isSameDay(date1: Date | string, date2: Date | string): boolean {
  const d1 = typeof date1 === "string" ? new Date(date1) : date1;
  const d2 = typeof date2 === "string" ? new Date(date2) : date2;

  return formatDateToString(d1) === formatDateToString(d2);
}

/**
 * Helper function to format Date to YYYY-MM-DD string without timezone issues
 */
export function formatDateToString(date: Date): string {
  return (
    date.getFullYear() +
    "-" +
    String(date.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(date.getDate()).padStart(2, "0")
  );
}

/**
 * Get today's date as YYYY-MM-DD in local timezone (avoiding timezone conversion issues)
 */
export function getTodayString(): string {
  return formatDateToString(new Date());
}

/**
 * Add days to a date
 */
export function addDays(date: Date | string, days: number): Date {
  const d = typeof date === "string" ? new Date(date) : new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

/**
 * Parse date string safely
 */
export function parseDate(dateString: string | null | undefined): Date | null {
  if (!dateString) {
    return null;
  }

  const date = new Date(dateString);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Create a new timestamp for database operations (always UTC)
 */
export function createTimestamp(): Date {
  return new Date();
}

/**
 * Convert database timestamp to local timezone for API responses
 */
export function formatTimestampForAPI(
  timestamp: Date | string | null
): string | null {
  if (!timestamp) {
    return null;
  }

  const date = typeof timestamp === "string" ? new Date(timestamp) : timestamp;
  return date.toISOString();
}
