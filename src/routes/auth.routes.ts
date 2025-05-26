import { Router } from "express";
import { AuthController } from "@/controllers/auth.controller";
import { ZodError } from "zod";

const router = Router();
const controller = new AuthController();

// Check email endpoint
router.post("/check-email", async (req, res) => {
  try {
    const response = await controller.checkEmail(req.body);
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

// Login endpoint
router.post("/login", async (req, res) => {
  try {
    const response = await controller.login(req.body);
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

// Signup endpoint
router.post("/signup", async (req, res) => {
  try {
    const response = await controller.signup(req.body);
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

// Generate auth code endpoint
router.post("/generate-auth-code", async (req, res) => {
  try {
    const response = await controller.generateAuthCode(req.body);
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

// Verify endpoint
router.post("/verify", async (req, res) => {
  try {
    const response = await controller.verify(req.body);
    if (response.success) {
      res.json({
        success: true,
        token: response.token,
        needsOnboarding: response.needsOnboarding,
        user: response.user,
        email: response.email,
      });
    } else {
      res.status(401).json(response);
    }
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

export const authRouter = router;
