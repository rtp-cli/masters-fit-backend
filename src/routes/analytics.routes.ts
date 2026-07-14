import { Router, Request } from "express";
import { AnalyticsController } from "@/controllers/analytics.controller";
import { ZodError } from "zod";
import { requireAuth } from "@/middleware/authz.middleware";

// Extend Request interface for authenticated requests
interface AuthenticatedRequest extends Request {
  userId: number;
  userUuid?: string;
  clientIP?: string;
}

const router = Router();
const controller = new AnalyticsController();

// Business/controller error mapping (authn handled by requireAuth middleware).
// The acting user is always derived from the JWT (authReq.userId/userUuid),
// never from the request body — so these need auth but no ownership check.
const handleError = (error: unknown, res: any) => {
  if (error instanceof ZodError) {
    res
      .status(400)
      .json({ success: false, error: "Invalid request data", details: error.issues });
  } else if (error instanceof Error) {
    res.status(400).json({ success: false, error: error.message });
  } else {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

router.post("/video-engagement", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const response = await controller.trackVideoEngagement(
      req.body,
      authReq,
      authReq.userUuid
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

router.post("/app-opened", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const response = await controller.trackAppOpened(
      req.body,
      authReq,
      authReq.userUuid
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

router.post("/workout-abandoned", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const response = await controller.trackWorkoutAbandoned(
      req.body,
      authReq,
      authReq.userUuid
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

router.post("/workout-started", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const response = await controller.trackWorkoutStarted(
      req.body,
      authReq,
      authReq.userUuid
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

router.post("/workout-completed", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const response = await controller.trackWorkoutCompleted(
      req.body,
      authReq,
      authReq.userUuid
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

router.post("/onboarding-started", requireAuth, async (req, res) => {
  try {
    const authReq = req as AuthenticatedRequest;
    const response = await controller.trackOnboardingStarted(
      req.body,
      authReq,
      authReq.userUuid
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

export const analyticsRouter = router;
