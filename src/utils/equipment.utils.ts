/**
 * Utility functions for handling equipment data consistently
 */

/**
 * Safely format equipment array/string for display
 * @param equipment - Equipment data that might be an array, string, or null
 * @returns Formatted equipment string or undefined
 */
export function formatEquipment(equipment: string[] | string | null | undefined): string | undefined {
  if (!equipment) {
    return undefined;
  }
  
  if (Array.isArray(equipment)) {
    return equipment.join(", ");
  }
  
  if (typeof equipment === "string") {
    return equipment;
  }
  
  return undefined;
}

/**
 * Safely check if equipment is an array
 * @param equipment - Equipment data
 * @returns True if equipment is an array
 */
export function isEquipmentArray(equipment: any): equipment is string[] {
  return Array.isArray(equipment);
}

/**
 * Ensure equipment is in array format
 * @param equipment - Equipment data
 * @returns Equipment as array
 */
export function normalizeEquipment(equipment: string[] | string | null | undefined): string[] {
  if (!equipment) {
    return [];
  }
  
  if (Array.isArray(equipment)) {
    return equipment;
  }
  
  if (typeof equipment === "string") {
    return equipment.split(", ").map(e => e.trim()).filter(e => e);
  }
  
  return [];
}