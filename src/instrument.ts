import dotenv from "dotenv";
dotenv.config();

import * as Sentry from "@sentry/node";

const SENTRY_DSN = process.env.SENTRY_DSN;

if (SENTRY_DSN) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: process.env.NODE_ENV || "development",
    tracesSampleRate: process.env.NODE_ENV === "production" ? 0.2 : 1.0,
    // Capture 100% of errors, sample traces
    // Automatically instruments: Express, pg, Redis, Bull
  });
} else {
  console.warn("[Sentry] No DSN configured — skipping initialization");
}

export { Sentry };
