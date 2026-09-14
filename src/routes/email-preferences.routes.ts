import { Router, Request, Response } from "express";

import { onboardingNudgeService } from "@/services/onboarding-nudge.service";
import { verifyUnsubscribeToken } from "@/utils/email-token";
import { logger } from "@/utils/logger";

const router = Router();

/**
 * Unsubscribe from non-transactional email.
 *
 * PUBLIC and UNAUTHENTICATED on purpose — the person clicking is in their mail
 * client, not the app, and may have no session anywhere. The signed token is
 * the whole authorization story, and the only thing it can do is set one
 * column. Someone who forges a token still cannot read anything.
 *
 * Never leaks whether a token was invalid versus unknown: every failure renders
 * the same page. The alternative turns this into an account-existence oracle.
 */

const page = (title: string, message: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  body { margin:0; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
         background:#FFFFFF; color:#1A1A1A; display:flex; align-items:center; justify-content:center;
         min-height:100vh; padding:24px; }
  .card { max-width:420px; text-align:center; }
  h1 { font-size:20px; margin:0 0 12px; }
  p { font-size:15px; line-height:1.6; color:#555; margin:0; }
  @media (prefers-color-scheme: dark) {
    body { background:#111; color:#F2F2F2; }
    p { color:#BBB; }
  }
</style>
</head>
<body><div class="card"><h1>${title}</h1><p>${message}</p></div></body>
</html>`;

const DONE = page(
  "You're unsubscribed",
  "You won't get any more setup reminders from MastersFit. Account and billing emails are unaffected."
);

// Deliberately identical for a bad token and an unknown user.
const FAILED = page(
  "This link didn't work",
  "It may have been broken by your email client. Email rtp@mastersfit.ai and we'll take care of it."
);

async function applyOptOut(token: unknown): Promise<boolean> {
  const userId = verifyUnsubscribeToken(
    typeof token === "string" ? token : undefined
  );
  if (!userId) return false;

  const ok = await onboardingNudgeService.optOut(userId);
  logger.info("Email unsubscribe processed", {
    operation: "unsubscribe",
    metadata: { userId, found: ok },
  });
  return ok;
}

router.get("/unsubscribe", async (req: Request, res: Response) => {
  try {
    const ok = await applyOptOut(req.query.token);
    res.status(ok ? 200 : 400).type("html").send(ok ? DONE : FAILED);
  } catch (error) {
    logger.error("Unsubscribe failed", error as Error, {
      operation: "unsubscribe",
    });
    res.status(500).type("html").send(FAILED);
  }
});

/**
 * RFC 8058 one-click. Gmail and Yahoo POST here directly from the inbox UI
 * when the List-Unsubscribe-Post header is present; they never render the
 * response, so it stays plain text. Must not require a session or a CSRF token
 * — the sender is a mail provider, not a browser with our cookies.
 */
router.post("/unsubscribe", async (req: Request, res: Response) => {
  try {
    const ok = await applyOptOut(req.query.token ?? req.body?.token);
    res.status(ok ? 200 : 400).type("text/plain").send(ok ? "Unsubscribed" : "Invalid token");
  } catch (error) {
    logger.error("One-click unsubscribe failed", error as Error, {
      operation: "unsubscribe",
    });
    res.status(500).type("text/plain").send("Error");
  }
});

export { router as emailPreferencesRouter };
