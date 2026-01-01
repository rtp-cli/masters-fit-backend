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
    // Define import.meta.url for CommonJS bundle
    options.define = {
      ...options.define,
      "import.meta.url": JSON.stringify(
        "file://" + process.cwd() + "/dist/index.cjs"
      ),
    };
  },
});
