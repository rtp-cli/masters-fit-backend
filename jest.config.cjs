/**
 * Jest config for backend unit tests.
 *
 * The project ships as ESM (package.json "type": "module"), but ts-jest compiles
 * the tests to CommonJS for the test runner. Tests should import their subject via
 * relative paths and avoid pulling in ESM-only runtime deps so they stay fast and
 * isolated. The `@/` path alias is mapped here for tests that need it.
 */
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/*.test.ts"],
  moduleNameMapper: {
    // Some source files use ESM-style .js-suffixed imports pointing at real
    // .ts files (e.g. "@/config/database.js") — this must come before the
    // generic rule below, or that rule matches first and the .js suffix
    // gets baked into the mapped path, which doesn't exist on disk.
    "^@/(.*)\\.js$": "<rootDir>/src/$1",
    "^@/(.*)$": "<rootDir>/src/$1",
  },
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        tsconfig: {
          // ts-jest needs CommonJS output regardless of the app's ESM build.
          module: "CommonJS",
          esModuleInterop: true,
          experimentalDecorators: true,
          emitDecoratorMetadata: true,
        },
      },
    ],
  },
};
