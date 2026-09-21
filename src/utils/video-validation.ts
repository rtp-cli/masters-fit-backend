import { logger } from "@/utils/logger";

/**
 * Server-side validation of exercise demo links, mirroring the client's
 * YouTube URL parsing. The verdict is stored on exercises.has_demo so the
 * app can render demo affordances synchronously instead of every client
 * firing N oEmbed requests per workout for an answer that is identical for
 * every user and changes maybe yearly.
 *
 * [#103] A demo is not always a video. The generation prompt has long told the
 * model that for movements with no required form — "something like walking or
 * cycling" — it must attach a public IMAGE instead of a YouTube link. Nothing
 * honoured that: checkDemoLink returned false for anything it could not parse
 * as YouTube, so an image link was stamped has_demo=false and the client
 * short-circuits on exactly that value. The instruction wrote data into a dead
 * end. Image links now resolve to a real verdict.
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
 * [#103] Whether a link points at a still image we can show as the demo.
 *
 * Deliberately EXTENSION-ONLY, and deliberately narrower than the client's
 * original predicate, which also treated any host containing "cdn", "img" or
 * "images", or any URL carrying a `format` query param, as an image. That was
 * harmless while images never rendered; now that they do, it would classify
 * arbitrary CDN-hosted pages as images and render them as broken pictures.
 * A demo asset is worth being strict about — a missing chip is a smaller
 * failure than a broken one.
 *
 * Mirrored in the client's lib/exercise-video.ts; keep the two in lockstep.
 */
export function isImageLink(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const { pathname } = new URL(url);
    return /\.(jpe?g|png|gif|webp|svg)$/i.test(pathname);
  } catch {
    return false;
  }
}

/**
 * Resolve a link to a has_demo verdict.
 *
 * - `false`  — no link, not a parseable YouTube URL or image URL, or oEmbed
 *              says the video is dead (400 bad id, 401 embedding disabled,
 *              403, 404)
 * - `true`   — oEmbed 200 (playable and embeddable), or a well-formed image
 *              URL. An image needs no liveness check: there is no embedding
 *              permission to revoke and no oEmbed endpoint to ask, so a 404
 *              at render time is the client's `onError` to handle, exactly as
 *              it already does for a video that dies after we checked.
 * - `null`   — transient failure (429/5xx/network); unknown, try again later.
 *              Callers store null so the backfill can retry and the client
 *              renders optimistically.
 */
export async function checkDemoLink(
  link: string | null | undefined
): Promise<boolean | null> {
  if (!link) return false;

  const videoId = extractYouTubeVideoId(link);
  if (!videoId) return isImageLink(link);

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
