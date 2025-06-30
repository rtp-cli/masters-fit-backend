import express from "express";
import cors from "cors";
import morgan from "morgan";
import swaggerUi from "swagger-ui-express";
import { authRouter } from "@/routes/auth.routes";
import { profileRouter } from "@/routes/profile.routes";
import { workoutRouter } from "@/routes/workout.routes";
import { exerciseRouter } from "@/routes/exercise.routes";
import { logsRouter } from "@/routes/logs.routes";
import { promptsRouter } from "@/routes/prompts.routes";
import { searchRouter } from "@/routes/search.routes";
import dashboardRouter from "@/routes/dashboard.routes";
import { errorHandler } from "@/middleware/error.middleware";
// Import the auto-generated swagger spec
import swaggerJson from "../generated/swagger.json";
import path from "path";

function extractRoutes(app: express.Application) {
  const routes: Record<string, string[]> = {};

  app._router.stack.forEach((middleware: any) => {
    if (middleware.route) {
      // direct routes like app.get("/api")
      const base = "/";
      routes[base] = routes[base] || [];
      routes[base].push(middleware.route.path);
    } else if (middleware.name === "router" && middleware.handle.stack) {
      const basePath =
        middleware.regexp?.source
          ?.replace("^\\", "")
          ?.replace("\\/?(?=\\/|$)", "")
          ?.replace(/\\\//g, "/") || "";

      middleware.handle.stack.forEach((handler: any) => {
        if (handler.route?.path) {
          const path = basePath + handler.route.path;
          routes[basePath] = routes[basePath] || [];
          routes[basePath].push(path);
        }
      });
    }
  });

  return routes;
}

const app = express();

// Middleware
app.use(express.static(path.join(__dirname, "..", "public")));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
    optionsSuccessStatus: 200,
  })
);

// Logging
if (process.env.NODE_ENV === "development") {
  app.use(morgan("dev"));
}

// Swagger UI
app.use(
  "/api/docs",
  swaggerUi.serve,
  swaggerUi.setup(swaggerJson, {
    customCss: ".swagger-ui .topbar { display: none }",
    customSiteTitle: "Masters Fit API Documentation",
  })
);

// Routes
app.use("/api/auth", authRouter);
app.use("/api/profile", profileRouter);
app.use("/api/workouts", workoutRouter);
app.use("/api/exercises", exerciseRouter);
app.use("/api/prompts", promptsRouter);
app.use("/api/logs", logsRouter);
app.use("/api/search", searchRouter);
app.use("/api/dashboard", dashboardRouter);

// API Info route
app.get("/api", (req, res) => {
  const routes = extractRoutes(app);
  res.json({
    name: "Masters Fit API",
    version: "1.0.0",
    description: "Fitness tracking application API",
    documentation: "/api/docs",
    endpoints: routes,
  });
});

// Error handling
app.use(errorHandler);

export default app;
