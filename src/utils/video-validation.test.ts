import { describe, it, expect } from "@jest/globals";
import { isImageLink, extractYouTubeVideoId } from "@/utils/video-validation";

describe("isImageLink [#103]", () => {
  it.each([
    "https://images.unsplash.com/photo-123.jpg",
    "https://example.com/a/b/walk.JPEG",
    "https://cdn.example.com/x.png",
    "https://example.com/diagram.svg",
    "https://example.com/loop.gif",
    "https://example.com/pic.webp",
    "https://example.com/pic.jpg?w=800&fit=crop",
  ])("accepts %s", (url) => {
    expect(isImageLink(url)).toBe(true);
  });

  // The client's original predicate treated any host containing cdn/img/images,
  // or any URL with a `format` param, as an image. Harmless while images never
  // rendered; now it would put a broken picture in the demo sheet.
  it.each([
    ["a CDN-hosted page with no image extension", "https://cdn.example.com/article/walking"],
    ["a host merely containing 'images'", "https://images.example.com/gallery"],
    ["a format query param on a non-image", "https://example.com/data?format=json"],
    ["a YouTube link", "https://www.youtube.com/watch?v=cO3lDuMXuzc"],
    ["a bare domain", "https://example.com"],
    ["not a URL at all", "walking"],
    ["an empty string", ""],
    ["null", null],
  ])("rejects %s", (_label, url) => {
    expect(isImageLink(url as string | null)).toBe(false);
  });

  it("does not treat an extension in the query string as an image", () => {
    expect(isImageLink("https://example.com/page?next=/photo.jpg")).toBe(false);
  });
});

// checkDemoLink's YouTube branch hits the network, so only the image branch —
// which is deliberately network-free — is asserted here.
describe("checkDemoLink image branch [#103]", () => {
  it("does not mistake an image link for a YouTube id", () => {
    expect(extractYouTubeVideoId("https://images.unsplash.com/photo-1.jpg")).toBeNull();
  });
});
