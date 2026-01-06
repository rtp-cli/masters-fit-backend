import { Router } from "express";
import { AuthController } from "@/controllers/auth.controller";
import { ZodError } from "zod";
import { expressAuthentication } from "@/middleware/auth.middleware";

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

// Get waiver status endpoint (authenticated)
router.get("/waiver-status", async (req, res) => {
  try {
    // Authenticate the request
    await expressAuthentication(req as any, "bearerAuth");

    const response = await controller.getWaiverStatus(req as any);
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

// Accept waiver endpoint (authenticated)
router.post("/accept-waiver", async (req, res) => {
  try {
    // Authenticate the request
    await expressAuthentication(req as any, "bearerAuth");

    const response = await controller.acceptWaiver(req as any, req.body);
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

// Token refresh endpoint
router.post("/refresh", async (req, res) => {
  try {
    const response = await controller.refreshToken(req.body);
    if (response.success) {
      res.json(response);
    } else {
      // Check error type to set appropriate status
      if (response.error?.includes("Invalid or expired")) {
        res.status(401).json(response);
      } else if (response.error?.includes("required")) {
        res.status(400).json(response);
      } else {
        res.status(500).json(response);
      }
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

// Logout endpoint
router.post("/logout", async (req, res) => {
  try {
    const response = await controller.logout(req.body);
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

// Delete account endpoint (authenticated)
router.delete("/delete-account", async (req, res) => {
  try {
    // Authenticate the request
    await expressAuthentication(req as any, "bearerAuth");

    const response = await controller.deleteAccount(req as any);
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

export const authRouter = router;
