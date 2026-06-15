---
name: add-api-endpoint
description: Use when adding, creating, or exposing a new backend API endpoint, route, or controller method (e.g. "add a GET /workouts/favorites endpoint", "create an API for X", "expose Y to the app"). Covers the full TSOA controller + service + manual route wiring + spec regeneration chain.
---

# Add an API endpoint

Adding an endpoint in this codebase is a **5-step chain**. Skipping a step is the #1
mistake here: a new controller method does **not** become reachable until it's also wired
into a route file by hand. Do every step in order.

Use a concrete example throughout: adding `GET /workouts/favorites`.

## Before you start

Decide:
- **Which resource** does this belong to? (e.g. `workout`) → you'll edit the `workout.*` files.
- **Is it a brand-new resource** (no existing `*.controller.ts` for it)? If yes, you also do Step 4b.
- **HTTP method + path + auth?** Most endpoints require auth (`bearerAuth`).

## Step 1 — Add the service method (business logic)

In `src/services/<resource>.service.ts`, add a method to the service class. This is where the
real work happens (DB queries, etc.). Services are singletons — add the method to the class,
don't create new patterns.

```ts
// inside class WorkoutService
public async getFavorites(userId: number): Promise<Workout[]> {
  // ...query the db via drizzle...
}
```

## Step 2 — Add the controller method (the API surface + docs)

In `src/controllers/<resource>.controller.ts`, add a method with TSOA decorators. Keep it
thin — validate input, call the service, return. Match the decorators already used in the file.

```ts
// inside @Route("workouts") class WorkoutController
@Get("favorites")
@Security("bearerAuth")
public async getFavorites(@Request() req: ExpressRequest): Promise<ApiResponse<Workout[]>> {
  const userId = /* get from authenticated request */;
  return { success: true, data: await workoutService.getFavorites(userId) };
}
```

> The TSOA decorators (`@Get`, `@Security`, etc.) only generate **documentation and the OpenAPI
> spec**. They do **not** route real traffic. That's Step 3.

## Step 3 — Wire the route by hand (this is what actually serves traffic)

In `src/routes/<resource>.routes.ts`, add the Express handler. Copy the shape of the existing
handlers in that file exactly — auth check first, then call the controller, then the standard
try/catch that maps errors to status codes.

```ts
router.get("/favorites", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const result = await controller.getFavorites(req);
    res.json(result);
  } catch (error) {
    console.error("Error getting favorites:", error);
    if (error instanceof Error && error.message === "Invalid or expired token") {
      res.status(401).json({ success: false, error: error.message });
    } else if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ success: false, error: "Unauthorized" });
    } else {
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});
```

⚠️ **Route ordering matters.** A literal path like `/favorites` must be declared **before** a
dynamic one like `/:id`, or Express will treat "favorites" as an `:id`. Put specific routes first.

## Step 4 — Make sure the router is registered

**4a. Existing resource:** if `<resource>.routes.ts` already existed, it's already registered —
nothing to do.

**4b. Brand-new resource:** wire the new router into the app:
1. Export it from `src/routes/index.ts` (add a line matching the others).
2. Import and `app.use("/api/<resource>", <resource>Router)` in `src/app.ts`, next to the
   other `app.use(...)` calls.

## Step 5 — Regenerate the spec

```bash
npm run tsoa
```

This rebuilds `generated/` (routes + swagger.json) from your decorators. **Never edit
`generated/` by hand.**

## ✅ How to know it worked

Run these and confirm each is clean:

```bash
npm run tsc     # no type errors
npm run lint    # no lint errors
npm run dev     # server boots without errors
```

Then verify the endpoint is live:
1. Open `http://localhost:5000/docs` — your new endpoint should appear under its tag.
2. Hit it (via the docs "Try it out", or curl). For an authed route, include a bearer token.
3. Confirm you get the expected JSON, not a 404 (404 = the route wiring in Step 3 is missing).

If `/docs` shows it but calling it 404s, you did Steps 1–2 but skipped Step 3.
