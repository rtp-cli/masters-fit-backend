import { shareRequestSchema } from "@/models";
import { shareService } from "@/services";
import type { ApiResponse } from "@/types/common/responses";

// Controller for the share-a-workout feature. The routes are hand-wired in
// share.routes.ts (like feedback/analytics); this class holds the orchestration
// and always takes the acting user from the JWT (request.userId), never the body.
export class ShareController {
  /** POST /api/share/preview — non-persisted preview URL. */
  async createPreview(
    request: { userId: number },
    body: unknown
  ): Promise<ApiResponse<{ previewUrl: string }>> {
    const input = shareRequestSchema.parse(body);
    const data = await shareService.createPreview(request.userId, input);
    return { success: true, data };
  }

  /** POST /api/share/workout — mint (or reuse) a published public link. */
  async createShare(
    request: { userId: number },
    body: unknown
  ): Promise<ApiResponse<{ code: string; url: string; cardUrl: string }>> {
    const input = shareRequestSchema.parse(body);
    const data = await shareService.createShare(request.userId, input);
    return { success: true, data };
  }

  /** GET /api/share/:code — PUBLIC, no auth. Returns the frozen snapshot only. */
  async getPublic(code: string) {
    return shareService.getPublicByCode(code);
  }

  /** GET /api/share — the caller's links, newest first. */
  async listMine(request: { userId: number }) {
    const links = await shareService.listForUser(request.userId);
    return { success: true, data: links };
  }

  /** DELETE /api/share/:code — owner-only revoke. */
  async revoke(request: { userId: number }, code: string): Promise<ApiResponse> {
    await shareService.revoke(request.userId, code);
    return { success: true };
  }
}

export const shareController = new ShareController();
