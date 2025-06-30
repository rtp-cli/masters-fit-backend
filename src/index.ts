import app from "./app";
import { logger } from "./utils/logger";

const port = parseInt(process.env.PORT || "5000", 10);

app.listen(port, "0.0.0.0", () => {
  logger.info("Server started successfully", {
    operation: "serverStart",
    metadata: {
      port,
      environment: process.env.NODE_ENV || "development",
      docsUrl: `${process.env.API_URL}:${port}/api/docs`,
    },
  });
});

export default app;
