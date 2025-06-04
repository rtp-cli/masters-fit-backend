export interface LinkInfo {
  type: "youtube" | "unknown";
  embedUrl?: string;
  thumbnailUrl?: string;
  isValid: boolean;
}

/**
 * Analyze and process exercise link to determine type and generate embed information
 * @param link URL to analyze
 * @returns Link information including type and embed details
 */
export function processExerciseLink(link: string | null | undefined): LinkInfo {
  if (!link) {
    return { type: "unknown", isValid: false };
  }

  try {
    const url = new URL(link);

    // Check for YouTube URLs only
    const youtubePatterns = [
      /^(https?:\/\/)?(www\.)?(youtube\.com|youtu\.be)\/.+/,
      /^(https?:\/\/)?(www\.)?youtube\.com\/watch\?v=.+/,
      /^(https?:\/\/)?(www\.)?youtu\.be\/.+/,
    ];

    const isYoutube = youtubePatterns.some((pattern) => pattern.test(link));

    if (isYoutube) {
      const videoId = extractYouTubeVideoId(link);
      if (videoId) {
        return {
          type: "youtube",
          embedUrl: `https://www.youtube.com/embed/${videoId}`,
          thumbnailUrl: `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
          isValid: true,
        };
      }
    }

    return { type: "unknown", isValid: false };
  } catch (error) {
    return { type: "unknown", isValid: false };
  }
}

/**
 * Extract YouTube video ID from various YouTube URL formats
 * @param url YouTube URL
 * @returns Video ID or null if not found
 */
function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([^&\n?#]+)/,
    /youtube\.com\/watch\?.*v=([^&\n?#]+)/,
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  return null;
}

/**
 * Validate if a URL is a valid exercise link (YouTube only)
 * @param link URL to validate
 * @returns Validation result
 */
export function validateExerciseLink(link: string): {
  isValid: boolean;
  type?: "youtube";
  error?: string;
} {
  const linkInfo = processExerciseLink(link);

  if (linkInfo.isValid) {
    return {
      isValid: true,
      type: linkInfo.type as "youtube",
    };
  }

  return {
    isValid: false,
    error: "Link must be a YouTube video URL",
  };
}
