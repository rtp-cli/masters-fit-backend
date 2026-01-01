import { Router } from "express";
import { SubscriptionController } from "@/controllers/subscription.controller";
import { ZodError } from "zod";

const router = Router();
const controller = new SubscriptionController();

// Helper function for consistent error handling
const handleError = (error: unknown, res: any) => {
  if (error instanceof ZodError) {
    res.status(400).json({ success: false, error: "Invalid request data" });
  } else if (error instanceof Error) {
    res.status(400).json({ success: false, error: error.message });
  } else {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
};

// Get subscription plans (public endpoint - no auth required)
router.get("/plans", async (req, res) => {
  try {
    const response = await controller.getSubscriptionPlans();
    res.json(response);
  } catch (error) {
    handleError(error, res);
  }
});

// RevenueCat webhook endpoint (no auth required - uses authorization header verification)
// @see https://www.revenuecat.com/docs/integrations/webhooks#security-and-best-practices
router.post("/webhooks/revenuecat", async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    const response = await controller.handleRevenueCatWebhook(
      req,
      req.body,
      authHeader
    );

    // Determine status code from response
    // RevenueCat expects 200 for success, any other status triggers retry
    let statusCode = 200;
    if (!response.success) {
      if (response.message === "Unauthorized") {
        statusCode = 401;
      } else {
        statusCode = 500; // Will trigger RevenueCat retry
      }
    }

    res.status(statusCode).json(response);
  } catch (error) {
    // Log the actual error for debugging
    console.error("Webhook error:", error);
    handleError(error, res);
  }
});

export { router as subscriptionRouter };
