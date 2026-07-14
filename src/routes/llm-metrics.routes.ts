import { Router } from "express";
import { requireAuth, requireAdmin } from "@/middleware/authz.middleware";
import { llmGenerationLogsService } from "@/services/llm-generation-logs.service";

const router = Router();

// GET /api/admin/llm-metrics?startDate=2026-06-01&endDate=2026-06-30
// Org-wide LLM cost/usage report — admin only (previously any authenticated
// user could read it; there was no role check).
router.get("/", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const report = await llmGenerationLogsService.getReport({
      startDate: startDate as string | undefined,
      endDate: endDate as string | undefined,
    });
    res.json({ success: true, data: report });
  } catch (error) {
    res.status(500).json({ success: false, error: "Internal server error" });
  }
});

export { router as llmMetricsRouter };
