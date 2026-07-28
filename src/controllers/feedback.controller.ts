import {
  Body,
  Controller,
  Post,
  Route,
  Response,
  SuccessResponse,
  Security,
  Tags,
  Request,
} from "@tsoa/runtime";

import {
  insertAppFeedbackSchema,
  type AppFeedbackCategory,
  type AppFeedbackNoteSource,
} from "@/models";
import { appFeedbackService, emailService, userService } from "@/services";
import { ApiResponse } from "@/types/common/responses";
import { logger } from "@/utils/logger";

interface CreateFeedbackResponse extends ApiResponse {
  feedbackId?: number;
}

@Route("feedback")
@Tags("Feedback")
@Security("bearerAuth")
export class FeedbackController extends Controller {
  /**
   * Submit app feedback. The user is taken from the session, never the body.
   * Responds 201 as soon as the row commits — the email fan-out runs after,
   * off the response path, so a slow SMTP hop never makes the user think the
   * message was lost.
   */
  @Post("/")
  @Response<ApiResponse>(400, "Bad Request")
  @Response<ApiResponse>(429, "Too Many Requests")
  @SuccessResponse(201, "Created")
  public async createFeedback(
    @Request() request: any,
    @Body() requestBody: any
  ): Promise<CreateFeedbackResponse> {
    const userId: number = request.userId;

    // Take user identity from the session; body carries only content.
    const validated = insertAppFeedbackSchema
      .omit({ userId: true })
      .parse(requestBody);

    const { feedback, isNew } = await appFeedbackService.createFeedback(
      userId,
      {
        clientId: validated.clientId,
        category: validated.category as AppFeedbackCategory,
        message: validated.message,
        noteSource: validated.noteSource as AppFeedbackNoteSource,
        diagnostics:
          (validated.diagnostics as Record<string, unknown> | null) ?? null,
      }
    );

    this.setStatus(201);

    // Fan out email only for a freshly-created row — a retried duplicate has
    // already been (or is being) emailed. Fire-and-forget: the row is the
    // record of truth; email is a notification on top of it.
    if (isNew) {
      void this.fanOutEmail(feedback.id, userId, {
        category: feedback.category,
        message: feedback.message,
        diagnostics: feedback.diagnostics,
      });
    }

    return { success: true, feedbackId: feedback.id };
  }

  private async fanOutEmail(
    feedbackId: number,
    userId: number,
    data: {
      category: AppFeedbackCategory;
      message: string;
      diagnostics: Record<string, unknown> | null;
    }
  ): Promise<void> {
    try {
      const user = await userService.getUser(userId);
      await emailService.sendFeedbackEmail({
        feedbackId,
        category: data.category,
        message: data.message,
        userName: user?.name ?? null,
        userEmail: user?.email ?? null,
        diagnostics: data.diagnostics,
      });
      await appFeedbackService.markEmailSent(feedbackId);
    } catch (error) {
      // A silently dead queue looks exactly like nobody writing in — alert,
      // but never surface to the user: their row is already committed.
      logger.error("Feedback email fan-out failed", error as Error, {
        operation: "feedbackFanOutEmail",
        userId,
        metadata: { feedbackId, category: data.category },
      });
    }
  }
}

export const feedbackController = new FeedbackController();
