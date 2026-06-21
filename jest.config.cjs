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
