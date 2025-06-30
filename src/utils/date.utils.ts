/**
 * Centralized Date Utilities for Masters Fit Application
 *
 * This module provides standardized date handling to ensure:
 * 1. All workout dates are stored as YYYY-MM-DD strings (timezone-independent)
 * 2. All date comparisons use the same format
 * 3. Date calculations work consistently across timezones
 * 4. No timezone conversions when dealing with workout dates
 */

/**
 * Get current date in UTC as ISO string
 */
export function getCurrentUTCDate(): Date {
  return new Date();
}

/**
 * Get current date in YYYY-MM-DD format in LOCAL timezone
 * This is the authoritative function for getting "today" for workout purposes
 */
export function getCurrentDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get current date in YYYY-MM-DD format in a specific timezone
 * This is used for workout generation based on user's timezone
 */
export function getCurrentDateStringInTimezone(timezone: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    return formatter.format(now); // Returns YYYY-MM-DD in specified timezone
  } catch (error) {
    console.warn(`Invalid timezone ${timezone}, falling back to server time`);
    return getCurrentDateString(); // Fallback to server timezone
  }
}

/**
 * Convert any date input to UTC Date object (for database timestamps only)
 */
export function toUTCDate(dateInput: string | Date | null | undefined): Date {
  if (!dateInput) {
    return new Date();
  }

  if (typeof dateInput === "string") {
    // If it's just a date string (YYYY-MM-DD), treat as local date
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      const [year, month, day] = dateInput.split("-").map(Number);
      return new Date(year, month - 1, day); // month is 0-indexed
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

  // Handle YYYY-MM-DD strings specially for workout dates
  if (typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const [year, month, day] = dateInput.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    return new Intl.DateTimeFormat("en-US", options).format(date);
  }

  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat("en-US", options).format(date);
}

/**
 * Format date as YYYY-MM-DD string (timezone-independent for workout dates)
 */
export function formatDateAsString(
  dateInput: Date | string | null | undefined
): string {
  if (!dateInput) {
    return getCurrentDateString();
  }

  // If it's already a YYYY-MM-DD string, return as-is
  if (typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    return dateInput;
  }

  // Convert Date to local YYYY-MM-DD string
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Format date as YYYY-MM-DD string in local timezone (for display)
 */
export function formatDateAsLocalString(
  dateInput: Date | string | null | undefined
): string {
  return formatDateAsString(dateInput);
}

/**
 * Get start of day in UTC (for database queries only)
 */
export function getStartOfDayUTC(dateInput?: Date | string): Date {
  const date = dateInput ? toUTCDate(dateInput) : new Date();
  const startOfDay = new Date(date);
  startOfDay.setUTCHours(0, 0, 0, 0);
  return startOfDay;
}

/**
 * Get end of day in UTC (for database queries only)
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
 * Check if two dates are the same day (for workout date comparison)
 */
export function isSameDay(date1: Date | string, date2: Date | string): boolean {
  const d1String = formatDateAsString(date1);
  const d2String = formatDateAsString(date2);
  return d1String === d2String;
}

/**
 * Helper function to format Date to YYYY-MM-DD string without timezone issues
 */
export function formatDateToString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get today's date as YYYY-MM-DD in local timezone (avoiding timezone conversion issues)
 * This is the main function used for workout date operations
 */
export function getTodayString(): string {
  return getCurrentDateString();
}

/**
 * Add days to a date string or Date object, returns YYYY-MM-DD string
 */
export function addDays(date: Date | string, days: number): string {
  // Handle YYYY-MM-DD string input
  if (typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [year, month, day] = date.split("-").map(Number);
    const dateObj = new Date(year, month - 1, day);
    dateObj.setDate(dateObj.getDate() + days);
    return formatDateToString(dateObj);
  }

  // Handle Date object input
  const dateObj = typeof date === "string" ? new Date(date) : new Date(date);
  dateObj.setDate(dateObj.getDate() + days);
  return formatDateToString(dateObj);
}

/**
 * Create a date string for a specific day of the week (for workout scheduling)
 */
export function getDateForWeekday(weekday: string, afterDate?: string): string {
  const daysOfWeek = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  const targetIndex = daysOfWeek.indexOf(weekday.toLowerCase());
  if (targetIndex === -1) {
    throw new Error(`Invalid weekday: ${weekday}`);
  }

  // Start from afterDate or today
  const startDate = afterDate ? afterDate : getTodayString();
  const [year, month, day] = startDate.split("-").map(Number);
  const currentDate = new Date(year, month - 1, day);

  // Find the next occurrence of the target weekday
  while (currentDate.getDay() !== targetIndex) {
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return formatDateToString(currentDate);
}

/**
 * Create a date string for a specific day of the week in a specific timezone (for workout scheduling)
 */
export function getDateForWeekdayInTimezone(
  weekday: string,
  afterDate?: string,
  timezone?: string
): string {
  const daysOfWeek = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  const targetIndex = daysOfWeek.indexOf(weekday.toLowerCase());
  if (targetIndex === -1) {
    throw new Error(`Invalid weekday: ${weekday}`);
  }

  // Start from afterDate or today in the specified timezone
  const startDate = afterDate
    ? afterDate
    : timezone
      ? getCurrentDateStringInTimezone(timezone)
      : getTodayString();
  const [year, month, day] = startDate.split("-").map(Number);
  const currentDate = new Date(year, month - 1, day);

  // Find the next occurrence of the target weekday
  while (currentDate.getDay() !== targetIndex) {
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return formatDateToString(currentDate);
}

/**
 * Parse date string safely (for workout dates)
 */
export function parseDate(dateString: string | null | undefined): Date | null {
  if (!dateString) {
    return null;
  }

  // Handle YYYY-MM-DD format
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateString)) {
    const [year, month, day] = dateString.split("-").map(Number);
    return new Date(year, month - 1, day);
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
