---
name: add-api-endpoint
description: Use when adding, creating, or exposing a new backend API endpoint, route, or controller method (e.g. "add a GET /workouts/favorites endpoint", "create an API for X", "expose Y to the app"). Covers the full TSOA controller + service + manual route wiring + spec regeneration chain.
---

# Add an API endpoint

Adding an endpoint in this codebase is a **6-step chain**. Skipping a step is the #1
mistake here: a new controller method does **not** become reachable until it's also wired
into a route file by hand. Do every step in order.

Use a concrete example throughout: adding `GET /workouts/favorites`.

## Before you start

Decide:
- **Which resource** does this belong to? (e.g. `workout`) → you'll edit the `workout.*` files.
- **Is it a brand-new resource** (no existing `*.controller.ts` for it)? If yes, you also do Step 4b.
- **HTTP method + path + auth?** Almost every endpoint requires auth (`bearerAuth`) **and**
  ownership scoping — see Step 3b, which is not optional.

## Step 1 — Add the service method (business logic)

In `src/services/<resource>.service.ts`, add a method to the service class. This is where the
real work happens (DB queries, etc.). Services are singletons — add the method to the class,
don't create new patterns. **The service method must take `userId` and filter by it** — never
return rows for a caller who doesn't own them.

```ts
// inside class WorkoutService
public async getFavorites(userId: number): Promise<Workout[]> {
  // ...query the db via drizzle, WHERE userId = <userId>...
}
```

## Step 2 — Add the controller method (the API surface + docs)

In `src/controllers/<resource>.controller.ts`, add a method with TSOA decorators. Keep it
thin — call the service, return. Match the decorators already used in the file.

```ts
// inside @Route("workouts") class WorkoutController
@Get("favorites")
@Security("bearerAuth")
public async getFavorites(@Request() req: ExpressRequest): Promise<ApiResponse<Workout[]>> {
  const userId = (req as AuthenticatedRequest).userId; // set by expressAuthentication
  return { success: true, data: await workoutService.getFavorites(userId) };
}
```

> ⚠️ The TSOA decorators (`@Get`, `@Security`, etc.) only generate **documentation and the
> OpenAPI spec**. They do **not** route real traffic, and the generated router is **not mounted**
> (`app.ts` mounts the hand-written routers). Real traffic — and real auth — happen in Step 3.
> Never rely on `@Security` to protect an endpoint.

## Step 2b — Validate the request body with Zod (any POST/PUT/PATCH)

TSOA body validation does **not** run on the hand-written routes, and no controller currently
validates input — so "the type says it's a `CreateFavoriteRequest`" guarantees nothing at
runtime. For any endpoint with a body or non-trivial query params, parse it with a Zod schema
before calling the service. Reuse or extend the `insert<Resource>Schema` in
`src/models/<resource>.schema.ts` (`createInsertSchema`), and **cap array lengths** so a caller
can't submit an unbounded batch.

```ts
const body = insertFavoriteSchema.parse(req.body); // throws ZodError on bad input → 400
```

## Step 3 — Wire the route by hand (this is what actually serves traffic)

In `src/routes/<resource>.routes.ts`, add the Express handler. Copy the shape of the existing
handlers in that file — auth check first, then the controller call, then the try/catch.

```ts
router.get("/favorites", async (req, res) => {
  try {
    await expressAuthentication(req, "bearerAuth");
    const result = await controller.getFavorites(req);
    res.json(result);
  } catch (error) {
    logger.error("Error getting favorites", { error });
    if (error instanceof Error && error.message === "Invalid or expired token") {
      res.status(401).json({ success: false, error: error.message });
    } else if (error instanceof Error && error.message === "Unauthorized") {
      res.status(401).json({ success: false, error: "Unauthorized" });
    } else {
      // Do NOT echo error.message to the client for the 500 case — it leaks internals.
      res.status(500).json({ success: false, error: "Internal server error" });
    }
  }
});
```

⚠️ **Route ordering matters.** A literal path like `/favorites` must be declared **before** a
dynamic one like `/:id`, or Express will treat "favorites" as an `:id`. Put specific routes first.

## Step 3b — Enforce ownership (NOT optional — this is where IDOR bugs come from)

`expressAuthentication` sets `req.userId` from the verified JWT (`auth.middleware.ts:73`). That
is the **only** trustworthy source of the caller's identity.

- **Never trust a `userId` from the path or body.** Derive it from `req.userId`.
- For an endpoint that takes a resource id (`/:id`, `/:workoutId`, `/:userId`), you must confirm
  the resource belongs to the caller. Either compare directly:

  ```ts
  if (Number(req.params.userId) !== (req as AuthenticatedRequest).userId) {
    return res.status(403).json({ success: false, error: "Forbidden" });
  }
  ```

  or, for a nested resource, have the service JOIN up to `workouts.userId` and reject when it
  doesn't match the caller.

This codebase has a systemic pattern of handlers passing `Number(req.params.userId)` straight to
services (tracked in `launch_readiness/SECURITY_AUDIT_2026-07-10.md`, SEC-01). Do not add another
one — a new endpoint without an ownership check is a cross-tenant data leak.

## Step 4 — Make sure the router is registered

**4a. Existing resource:** if `<resource>.routes.ts` already existed, it's already mounted in
`app.ts` — nothing to do.

**4b. Brand-new resource:** the **only** load-bearing wiring is in `src/app.ts`:
1. `import { <resource>Router } from "@/routes/<resource>.routes";` next to the other imports.
2. `app.use("/api/<resource>", <resource>Router);` next to the other `app.use(...)` calls.

> Note: `src/routes/index.ts` is a stale `export *` barrel that **nothing imports** (it's already
> missing several live routers). Do **not** rely on adding a line there — it does nothing. The
> `app.ts` import + `app.use` is what makes the route reachable.

## Step 5 — Regenerate the spec

```bash
npm run tsoa
```

This rebuilds `generated/` (routes + swagger.json) from your decorators, for **docs only**.
**Never edit `generated/` by hand.**

## ✅ How to know it worked

Run the gates, but read them correctly — the backend baseline is not clean:

```bash
npm run tsc     # see note below
npm run lint    # currently NON-FUNCTIONAL — no ESLint config exists; it errors out
npm run dev     # server boots without errors
```

- **`npm run tsc`** currently reports a standing baseline of pre-existing errors. Your change
  must introduce **no new** errors — diff against `main` rather than expecting zero. (Fixing the
  baseline and the missing lint config is the job of the `release-preflight` skill.)
- **`npm run lint`** cannot run until an ESLint config is added — note that it didn't run rather
  than treating a crash as "clean."

Then verify the endpoint is live:
1. Open `http://localhost:5000/docs` — your new endpoint should appear under its tag.
2. Hit it (docs "Try it out", or curl) with a bearer token; then hit it with **another user's**
   id in the path and confirm you get 403, not their data (Step 3b).
3. Confirm expected JSON, not a 404 (404 = the route wiring in Step 3 is missing).

If `/docs` shows it but calling it 404s, you did Steps 1–2 but skipped Step 3.
