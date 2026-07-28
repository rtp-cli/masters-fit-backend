import { Router } from "express";
import { ZodError } from "zod";

import { FeedbackController } from "@/controllers/feedback.controller";
import { requireAuth } from "@/middleware/authz.middleware";
import { FeedbackRateLimitError } from "@/services/app-feedback.service";

const router = Router();
const controller = new FeedbackController();

// Business/controller error mapping (authn is handled by requireAuth first).
const handleError = (error: unknown, res: any) => {
  if (error instanceof FeedbackRateLimitError) {
    res.status(429).json({ success: false, error: error.message });
  } else if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: "Invalid request data" });
  } else if (error instanceof Error) {
    res.status(400).json({ success: false, error: error.message });
  } else {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

// Submit app feedback (user taken from the session, never the body)
router.post("/", requireAuth, async (req, res) => {
  try {
    const response = await controller.createFeedback(req, req.body);
    res.status(201).json(response);
  } catch (error) {
    handleError(error, res);
  }
});

export { router as feedbackRouter };
