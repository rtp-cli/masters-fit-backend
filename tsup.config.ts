import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  outDir: "dist",
  format: ["cjs"],
  target: "node18",
  clean: true,
  dts: false,
  tsconfig: "tsconfig.json",
  sourcemap: true,
  esbuildOptions(options) {
    options.alias = {
      "@": "./src",
    };
  },
});
