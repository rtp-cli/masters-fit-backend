import app from "./app";

const port = parseInt(process.env.PORT || "5000", 10);

// Only start the server if not in Vercel environment
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  app.listen(port, "0.0.0.0", () => {
    console.log(`Server is running on http://localhost:${port}`);
    console.log(`Swagger docs: http://localhost:${port}/api/docs`);
  });
}

export default app;
