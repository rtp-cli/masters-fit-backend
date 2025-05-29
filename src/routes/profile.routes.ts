import { ProfileController } from "@/controllers";
import { Router } from "express";
import { ZodError } from "zod";

const router = Router();
const controller = new ProfileController();

// Get profile
router.get("/:userId", async (req, res) => {
  try {
    const response = await controller.getProfile(Number(req.params.userId));
    res.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

// Create profile
router.post("/", async (req, res) => {
  try {
    const response = await controller.createProfile(req.body);
    res.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

// Update profile
router.put("/:id", async (req, res) => {
  try {
    const response = await controller.updateProfile(
      Number(req.params.id),
      req.body
    );
    res.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

// Update profile by userId
router.put("/user/:userId", async (req, res) => {
  try {
    const response = await controller.updateProfileByUserId(
      Number(req.params.userId),
      req.body
    );
    res.json(response);
  } catch (error) {
    if (error instanceof ZodError) {
      res.status(400).json({ success: false, error: "Invalid request data" });
    } else if (error instanceof Error) {
      res.status(400).json({ success: false, error: error.message });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

export { router as profileRouter };
