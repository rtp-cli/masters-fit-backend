import app from "./app";
import { logger } from "./utils/logger";
import { createServer } from "http";
import { Server } from "socket.io";
import { setSocketIOInstance } from "./utils/websocket-progress.utils";

const port = parseInt(process.env.PORT || "5000", 10);

// Create HTTP server
const server = createServer(app);

// Setup Socket.IO
const io = new Server(server, {
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    methods: ["GET", "POST"]
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  // Join user-specific room for targeted messaging
  socket.on('join-user-room', (userId: number) => {
    socket.join(`user-${userId}`);
  });

  socket.on('disconnect', () => {
    // Silent disconnect
  });
});

// Export io instance for use in other modules
export { io };

// Set up progress utility with io instance
setSocketIOInstance(io);

server.listen(port, "0.0.0.0", () => {
  logger.info("Server started successfully", {
    operation: "serverStart",
    metadata: {
      port,
      environment: process.env.NODE_ENV || "development",
      docsUrl: `${process.env.API_URL}:${port}/api/docs`,
      websocket: "enabled"
    },
  });
});

export default app;
