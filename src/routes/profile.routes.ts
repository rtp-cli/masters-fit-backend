import { ProfileController } from "@/controllers";
import { Router } from "express";
import { ZodError } from "zod";
import { expressAuthentication } from "@/middleware/auth.middleware";

const router = Router();
const controller = new ProfileController();

// Helper function for consistent error handling
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
router.get("/:userId", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const response = await controller.getProfile(Number(req.params.userId));
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Create profile
router.post("/", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const response = await controller.createProfile(req.body);
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Update profile
router.put("/:id", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const response = await controller.updateProfile(
      Number(req.params.id),
      req.body
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// Update profile by userId
router.put("/user/:userId", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const response = await controller.updateProfileByUserId(
      Number(req.params.userId),
      req.body
    );
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

export { router as profileRouter };
