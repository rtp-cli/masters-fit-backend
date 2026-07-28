import { logger } from "@/utils/logger";

/**
 * Server-side validation of exercise demo links, mirroring the client's
 * YouTube URL parsing. The verdict is stored on exercises.has_demo so the
 * app can render demo affordances synchronously instead of every client
 * firing N oEmbed requests per workout for an answer that is identical for
 * every user and changes maybe yearly.
 */

export function extractYouTubeVideoId(url: string): string | null {
  const patterns = [
    // Standard watch URL: watch?v=ID (also matches ...&v=ID).
    /[?&]v=([^&\n?#]+)/,
    // Short share links: youtu.be/ID (?si=… trackers stripped by the class).
    /youtu\.be\/([^&\n?#/]+)/,
    // Path-style IDs — the canonical embed plus the non-standard shapes the
    // seed data actually contains (watch/ID, shorts/ID, video/ID, v/ID). These
    // carry a valid 11-char ID; only the URL wrapper is off, so recover it
    // rather than dropping the demo.
    /youtube\.com\/(?:embed|shorts|video|watch|v)\/([^&\n?#/]+)/,
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
 * Resolve a link to a has_demo verdict.
 *
 * - `false`  — no link, not a parseable YouTube URL, or oEmbed says the video
 *              is dead (400 bad id, 401 embedding disabled, 403, 404)
 * - `true`   — oEmbed 200: playable and embeddable
 * - `null`   — transient failure (429/5xx/network); unknown, try again later.
 *              Callers store null so the backfill can retry and the client
 *              renders optimistically.
 */
export async function checkDemoLink(
  link: string | null | undefined
): Promise<boolean | null> {
  if (!link) return false;

  const videoId = extractYouTubeVideoId(link);
  if (!videoId) return false;

  const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(watchUrl)}&format=json`
    );
    if (res.ok) return true;
    if ([400, 401, 403, 404].includes(res.status)) return false;
    return null;
  } catch (error) {
    logger.warn("oEmbed demo-link check failed (transient)", {
      operation: "checkDemoLink",
      metadata: { link },
    });
    return null;
  }
}
