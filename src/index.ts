import app from "./app";

const port = parseInt(process.env.PORT || "5000", 10);
app.listen(port, "0.0.0.0", () => {
  console.log(`Server is running on http://localhost:${port}`);
  console.log(`Swagger docs: http://localhost:${port}/api/docs`);
});
