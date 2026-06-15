# MastersFit Backend — Claude Code Guide

This is the **API server** for MastersFit, a fitness-tracking app. The mobile app
(`masters-fit-frontend`) talks to this server over HTTP. If you're changing how data
is stored or how the app fetches it, you're probably in the right repo.

> **New here?** Read this whole file once. It's the "house rules." When you ask
> Claude Code to add an endpoint or change the database, it will pull in a matching
> **skill** (a step-by-step recipe) automatically — you don't need to memorize the steps.

---

## What this app is

- A REST API built with **Express + TypeScript**.
- It stores data in **PostgreSQL** (accessed through the **Drizzle ORM**).
- It generates personalized workouts using **LLMs** (Anthropic/OpenAI/others via LangChain),
  run in the background through **Bull + Redis** job queues.
- Errors are reported to **Sentry**; product analytics go to **Mixpanel**.
- API docs are auto-generated with **TSOA** and served at `/docs` when running.

## How to run it

```bash
npm install          # first time only
npm run dev          # starts on http://localhost:5000 with hot-reload
```

Healthy startup looks like:

```
🚀 Server running on port 5000
📚 API documentation available at http://localhost:5000/docs
💾 Database connected successfully
```

You need a `.env` file (ask the team for values — never commit it). Key variables:
`DATABASE_URL`, `ANTHROPIC_API_KEY`, `PORT`, `ALLOWED_ORIGINS`.

The mobile app expects this server at `http://localhost:5000/api`, so keep the port at 5000.

---

## Architecture map — where things live

Every feature flows through the same layers. Follow the data, top to bottom:

| Layer | Folder | Job |
|-------|--------|-----|
| **Route** | `src/routes/*.routes.ts` | Wires a URL (e.g. `GET /workouts`) to a controller method. Handles auth + error responses. **Wired manually** — see note below. |
| **Controller** | `src/controllers/*.controller.ts` | The API surface. Decorated with TSOA (`@Route`, `@Get`, `@Security`) so docs/types stay in sync. Thin — it calls a service. |
| **Service** | `src/services/*.service.ts` | The actual business logic. Singletons (see pattern below). |
| **Model (DB schema)** | `src/models/*.schema.ts` | Drizzle table definitions. Aggregated in `src/models/index.ts`. |
| **Types** | `src/types/` | Request/response shapes. |

Other folders: `jobs/` + `queues/` (background work, e.g. workout generation),
`middleware/` (auth, error handling), `config/` (DB pool, env), `utils/` (logger, helpers),
`templates/` (emails), `scripts/` (one-off maintenance scripts).

### ⚠️ The routing is a hybrid — read this carefully

Controllers carry **TSOA decorators**, but those decorators only generate the **docs/spec**.
The **runtime routing is wired by hand** in `src/routes/*.routes.ts`. This trips people up:
adding a controller method alone does **not** make the endpoint reachable. You must also add it
to the matching route file. The `add-api-endpoint` skill walks through both halves.

---

## Conventions (match the existing code)

- **Imports use the `@/` alias** → `import { x } from "@/services/foo.service"` maps to `src/`.
  Don't write long relative paths like `../../services/...`.
- **Services are singletons.** Each service class has a private constructor + `getInstance()`,
  and the file exports a ready instance at the bottom:
  ```ts
  export class FooService { /* ... */ }
  export const fooService = FooService.getInstance();
  ```
  Import and use `fooService` — don't `new FooService()`.
- **File names are kebab-case with a role suffix**: `foo.controller.ts`, `foo.service.ts`,
  `foo.routes.ts`, `foo.schema.ts`.
- **Validation** uses Zod (often via `drizzle-zod`'s `createInsertSchema`).
- **Logging**: use the shared `logger` from `@/utils/logger`, not raw `console.log`
  (the existing route files still use `console.error` in catch blocks — match the
  surrounding file rather than mixing styles).

---

## 🚧 Guardrails — do not skip these

1. **Never hand-edit `generated/`.** It's produced by `npm run tsoa`. If routes/spec look
   stale, regenerate — don't patch the output.
2. **After changing any controller, run `npm run tsoa`** so the spec and `/docs` stay correct.
3. **Never commit `.env`** or paste secrets into code. It's gitignored — keep it that way.
4. **Before saying a change is "done", run all three and confirm they pass:**
   ```bash
   npm run tsc     # type-checks (no errors)
   npm run lint    # style/quality
   npm run build   # tsoa spec + bundle — proves it compiles for production
   ```
   Report the actual output. If something fails, it is not done.
5. **Database changes are not automatic.** Editing a schema file does nothing until you push
   it — see the `change-db-schema` skill. Be careful: `db:push` alters the real database.

---

## Where to get unstuck

- Browse `http://localhost:5000/docs` to see every endpoint and its shape.
- Inspect the database visually: `npm run db:studio`.
- Check terminal logs (the server logs requests) and Sentry for production errors.
