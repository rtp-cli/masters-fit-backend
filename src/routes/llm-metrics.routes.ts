import { Router } from "express";
import { expressAuthentication } from "@/middleware/auth.middleware";
import { llmGenerationLogsService } from "@/services/llm-generation-logs.service";

const router = Router();

// GET /api/admin/llm-metrics?startDate=2026-06-01&endDate=2026-06-30
router.get("/", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const { startDate, endDate } = req.query;
    const report = await llmGenerationLogsService.getReport({
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
    });
    res.json({ success: true, data: report });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Unauthorized")) {
      res.status(401).json({ success: false, error: "Unauthorized" });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});

export { router as llmMetricsRouter };
