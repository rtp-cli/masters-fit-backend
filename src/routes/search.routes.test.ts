import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import request from "supertest";

// [LR-062] Route-level integration tests — the gap that let a real bug ship.
// Every existing test in this codebase calls a service or controller method
// directly, bypassing the actual Express route entirely. That's exactly how
// search.routes.ts's hand-wired /exercises route shipped calling
// `controller.searchExercises(query)` with a single argument — silently
// dropping limit/offset from every request — while every service-layer and
// controller-layer test kept passing, because none of them went through the
// route. These tests hit the real Express app (real route file, real
// controller) via supertest, with only auth and the service layer mocked,
// so a route/controller signature mismatch like that one fails here.

jest.mock("@/middleware/auth.middleware", () => ({
  expressAuthentication: jest.fn(async () => undefined),
}));

jest.mock("@/services", () => ({
  searchService: {
    searchExercises: jest.fn(),
  },
}));

import express from "express";
import { searchRouter } from "@/routes/search.routes";
import { searchService } from "@/services";

// Minimal harness app rather than importing the real @/app: that file uses
// import.meta (ESM-only) for a __dirname polyfill, which ts-jest's
// CommonJS transform can't compile — a known, documented constraint (see
// jest.config.cjs's comment: tests should import their subject directly,
// not the full app). Mounting the real searchRouter at its real path still
// exercises the actual route file this test exists to catch bugs in.
const app = express();
app.use(express.json());
app.use("/api/search", searchRouter);

type SearchExercisesResult = {
  exercises: any[];
  hasMore: boolean;
  total: number;
};
type SearchExercisesArgs = [string, { limit?: number; offset?: number }];

const mockSearchExercises = searchService.searchExercises as jest.Mock<
  (...args: SearchExercisesArgs) => Promise<SearchExercisesResult>
>;

describe("GET /api/search/exercises [LR-062]", () => {
  beforeEach(() => {
    mockSearchExercises.mockReset();
    mockSearchExercises.mockResolvedValue({
      exercises: [],
      hasMore: false,
      total: 0,
    });
  });

  it("forwards limit and offset from the query string to the service as numbers", async () => {
    await request(app)
      .get("/api/search/exercises")
      .query({ query: "back", limit: "5", offset: "20" })
      .set("Authorization", "Bearer test-token")
      .expect(200);

    expect(mockSearchExercises).toHaveBeenCalledWith("back", {
      limit: 5,
      offset: 20,
    });
    const [, options] = mockSearchExercises.mock.calls[0];
    expect(typeof options.limit).toBe("number");
    expect(typeof options.offset).toBe("number");
  });

  // This is the exact case that shipped broken: the route called the
  // controller with a single argument, so limit/offset were always
  // undefined regardless of what the request asked for.
  it("does NOT silently drop limit/offset — regression guard for the real LR-023 bug", async () => {
    await request(app)
      .get("/api/search/exercises")
      .query({ query: "back", limit: "5", offset: "20" })
      .set("Authorization", "Bearer test-token")
      .expect(200);

    const [, options] = mockSearchExercises.mock.calls[0];
    expect(options.limit).not.toBeUndefined();
    expect(options.offset).not.toBeUndefined();
  });

  it("omits limit/offset from the service call when not provided in the query string", async () => {
    await request(app)
      .get("/api/search/exercises")
      .query({ query: "back" })
      .set("Authorization", "Bearer test-token")
      .expect(200);

    expect(mockSearchExercises).toHaveBeenCalledWith("back", {
      limit: undefined,
      offset: undefined,
    });
  });

  it("returns the service's exercises/hasMore/total in the response body", async () => {
    mockSearchExercises.mockResolvedValue({
      exercises: [{ id: 1, name: "Push-Up" }],
      hasMore: true,
      total: 40,
    });

    const response = await request(app)
      .get("/api/search/exercises")
      .query({ query: "push" })
      .set("Authorization", "Bearer test-token")
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      exercises: [{ id: 1, name: "Push-Up" }],
      hasMore: true,
      total: 40,
    });
  });

  it("returns 400 when the query parameter is missing", async () => {
    const response = await request(app)
      .get("/api/search/exercises")
      .set("Authorization", "Bearer test-token")
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(mockSearchExercises).not.toHaveBeenCalled();
  });
});
