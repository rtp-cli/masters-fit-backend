import { Router, Request } from "express";
import { AnalyticsController } from "@/controllers/analytics.controller";
import { ZodError } from "zod";
import { expressAuthentication } from "@/middleware/auth.middleware";
import { logger } from "@/utils/logger";

// Extend Request interface for authenticated requests
interface AuthenticatedRequest extends Request {
  userId: number;
  userUuid?: string;
  clientIP?: string;
}

const router = Router();
const controller = new AnalyticsController();

// Track video engagement endpoint (authenticated)
router.post("/video-engagement", async (req, res) => {
  try {
    // Authenticate the request
    await expressAuthentication(req as AuthenticatedRequest, "bearerAuth");

    const authReq = req as AuthenticatedRequest;
    const response = await controller.trackVideoEngagement(
      req.body,
      authReq,
      authReq.userUuid
    );
    res.json(response);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ success: false, error: "Unauthorized" });
    } else if (
      error instanceof Error &&
      error.message === "Invalid or expired token"
    ) {
      res
        .status(401)
        .json({ success: false, error: "Invalid or expired token" });
    } else if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

// Track app opened endpoint (authenticated)
router.post("/app-opened", async (req, res) => {
  try {
    // Authenticate the request
    await expressAuthentication(req as AuthenticatedRequest, "bearerAuth");

    const authReq = req as AuthenticatedRequest;
    const response = await controller.trackAppOpened(
      req.body,
      authReq,
      authReq.userUuid
    );
    res.json(response);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ success: false, error: "Unauthorized" });
    } else if (
      error instanceof Error &&
      error.message === "Invalid or expired token"
    ) {
      res
        .status(401)
        .json({ success: false, error: "Invalid or expired token" });
    } else if (error instanceof ZodError) {
      res.status(400).json({
        success: false,
        error: "Invalid request data",
        details: error.issues,
      });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

// Track workout abandoned endpoint (authenticated)
router.post("/workout-abandoned", async (req, res) => {
  try {
    // Authenticate the request
    await expressAuthentication(req, "bearerAuth");

    const authReq = req as AuthenticatedRequest;
    const response = await controller.trackWorkoutAbandoned(
      req.body,
      authReq,
      authReq.userUuid
    );
    res.json(response);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ success: false, error: "Unauthorized" });
    } else if (
      error instanceof Error &&
      error.message === "Invalid or expired token"
    ) {
      res
        .status(401)
        .json({ success: false, error: "Invalid or expired token" });
    } else if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

// Track workout started endpoint (authenticated)
router.post("/workout-started", async (req, res) => {
  try {
    // Authenticate the request
    await expressAuthentication(req, "bearerAuth");

    const authReq = req as AuthenticatedRequest;
    const response = await controller.trackWorkoutStarted(
      req.body,
      authReq,
      authReq.userUuid
    );
    res.json(response);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ success: false, error: "Unauthorized" });
    } else if (
      error instanceof Error &&
      error.message === "Invalid or expired token"
    ) {
      res
        .status(401)
        .json({ success: false, error: "Invalid or expired token" });
    } else if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

// Track workout completed endpoint (authenticated)
router.post("/workout-completed", async (req, res) => {
  try {
    // Authenticate the request
    await expressAuthentication(req, "bearerAuth");

    const authReq = req as AuthenticatedRequest;
    const response = await controller.trackWorkoutCompleted(
      req.body,
      authReq,
      authReq.userUuid
    );
    res.json(response);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ success: false, error: "Unauthorized" });
    } else if (
      error instanceof Error &&
      error.message === "Invalid or expired token"
    ) {
      res
        .status(401)
        .json({ success: false, error: "Invalid or expired token" });
    } else if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

// Track onboarding started endpoint (authenticated)
router.post("/onboarding-started", async (req, res) => {
  try {
    // Authenticate the request
    await expressAuthentication(req, "bearerAuth");

    const authReq = req as AuthenticatedRequest;
    const response = await controller.trackOnboardingStarted(
      req.body,
      authReq,
      authReq.userUuid
    );
    res.json(response);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ success: false, error: "Unauthorized" });
    } else if (
      error instanceof Error &&
      error.message === "Invalid or expired token"
    ) {
      res
        .status(401)
        .json({ success: false, error: "Invalid or expired token" });
    } else if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

export const analyticsRouter = router;
