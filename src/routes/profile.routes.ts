import { ProfileController } from "@/controllers";
import { Router } from "express";
import { ZodError } from "zod";
import {
  requireAuth,
  requireSelf,
  requireOwnership,
  requireBodySelf,
} from "@/middleware/authz.middleware";

const router = Router();
const controller = new ProfileController();

// Business/controller error mapping (authn/authz handled by middleware).
const handleError = (error: unknown, res: any) => {
  if (error instanceof Error && error.message === "Invalid or expired token") {
    res.status(401).json({ success: false, error: error.message });
  } else if (error instanceof Error && error.message === "Unauthorized") {
    res.status(401).json({ success: false, error: "Unauthorized" });
  } else if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: "Invalid request data" });
  } else if (error instanceof Error) {
    res.status(400).json({ success: false, error: error.message });
  } else {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

// Get profile
router.get("/:userId", requireAuth, requireSelf("userId"), async (req, res) => {
  try {
    const response = await controller.getProfile(Number(req.params.userId));
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Create profile (body carries userId — must be the caller)
router.post("/", requireAuth, requireBodySelf("userId"), async (req, res) => {
  try {
    const response = await controller.createProfile(req.body);
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Update profile by profile id (verify ownership of the profile row AND that any
// userId in the body is the caller — the controller writes to body.userId)
router.put(
  "/:id",
  requireAuth,
  requireOwnership("profile", "id"),
  requireBodySelf("userId", { required: false }),
  async (req, res) => {
    try {
      const response = await controller.updateProfile(
        Number(req.params.id),
        req.body
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

// Update profile by userId
router.put(
  "/user/:userId",
  requireAuth,
  requireSelf("userId"),
  async (req, res) => {
    try {
      const response = await controller.updateProfileByUserId(
        Number(req.params.userId),
        req.body
      );
      res.json(response);
    } catch (error) {
      handleError(error, res);
    }
  }
);

export { router as profileRouter };
