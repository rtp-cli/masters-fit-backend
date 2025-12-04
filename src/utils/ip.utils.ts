import { logger } from "./logger";

// Cache for external IP to avoid repeated API calls
let cachedExternalIP: string | null = null;
let lastFetchTime: number = 0;
const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes

/**
 * Check if an IP address is localhost/private
 */
export function isLocalhost(ip: string): boolean {
  if (!ip) return true;

  // Remove IPv6 brackets if present
  const cleanIP = ip.replace(/^\[|\]$/g, '');

  return (
    cleanIP === '127.0.0.1' ||
    cleanIP === '::1' ||
    cleanIP === 'localhost' ||
    cleanIP.startsWith('192.168.') ||
    cleanIP.startsWith('10.') ||
    cleanIP.startsWith('172.16.') ||
    cleanIP.startsWith('172.17.') ||
    cleanIP.startsWith('172.18.') ||
    cleanIP.startsWith('172.19.') ||
    cleanIP.startsWith('172.20.') ||
    cleanIP.startsWith('172.21.') ||
    cleanIP.startsWith('172.22.') ||
    cleanIP.startsWith('172.23.') ||
    cleanIP.startsWith('172.24.') ||
    cleanIP.startsWith('172.25.') ||
    cleanIP.startsWith('172.26.') ||
    cleanIP.startsWith('172.27.') ||
    cleanIP.startsWith('172.28.') ||
    cleanIP.startsWith('172.29.') ||
    cleanIP.startsWith('172.30.') ||
    cleanIP.startsWith('172.31.')
  );
}

/**
 * Fetch external IP address using ipify service
 * Only called in development when localhost is detected
 */
export async function fetchExternalIP(): Promise<string | null> {
  const now = Date.now();

  // Return cached IP if still valid
  if (cachedExternalIP && (now - lastFetchTime) < CACHE_DURATION) {
    return cachedExternalIP;
  }

  try {
    // Use multiple services as fallbacks
    const services = [
      'https://api.ipify.org',
      'https://ipv4.icanhazip.com',
      'https://api.my-ip.io/ip'
    ];

    for (const service of services) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout

        const response = await fetch(service, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'MastersFit-Backend/1.0.0'
          }
        });

        clearTimeout(timeoutId);

        if (response.ok) {
          const ip = (await response.text()).trim();
          if (ip && !isLocalhost(ip)) {
            cachedExternalIP = ip;
            lastFetchTime = now;
            logger.info('External IP fetched successfully', {
              service,
              ip: ip.substring(0, 8) + '...' // Log partial IP for privacy
            });
            return ip;
          }
        }
      } catch (serviceError) {
        logger.debug(`Failed to fetch IP from ${service}`, serviceError as Error);
        continue; // Try next service
      }
    }

    logger.warn('All external IP services failed');
    return null;
  } catch (error) {
    logger.error('Failed to fetch external IP', error as Error);
    return null;
  }
}

/**
 * Get the best available IP address for analytics
 * In development: tries to get external IP when localhost is detected
 * In production: uses the provided IP as-is
 */
export async function getBestIP(originalIP?: string): Promise<string | undefined> {
  const isDevelopment = process.env.NODE_ENV === 'development';
  const overrideIP = process.env.ANALYTICS_IP_OVERRIDE;

  // If manual override is set (for testing specific locations)
  if (overrideIP) {
    logger.info('Using manual IP override for analytics', {
      override: overrideIP.substring(0, 8) + '...'
    });
    return overrideIP;
  }

  // If no original IP provided
  if (!originalIP) {
    if (isDevelopment) {
      logger.debug('No original IP provided, fetching external IP for development');
      return await fetchExternalIP() || undefined;
    }
    return undefined;
  }

  // If localhost detected in development, try to get external IP
  if (isDevelopment && isLocalhost(originalIP)) {
    logger.debug('Localhost detected in development, fetching external IP', {
      originalIP
    });

    const externalIP = await fetchExternalIP();
    if (externalIP) {
      return externalIP;
    }

    // Fall back to original IP if external fetch fails
    logger.debug('External IP fetch failed, using original IP');
  }

  return originalIP;
}

/**
 * Clear the cached external IP (useful for testing or manual refresh)
 */
export function clearIPCache(): void {
  cachedExternalIP = null;
  lastFetchTime = 0;
}