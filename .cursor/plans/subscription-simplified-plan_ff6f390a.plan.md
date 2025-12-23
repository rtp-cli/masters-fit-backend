---
name: subscription-simplified-plan
overview: Add free-trial limits (2 weekly generations, 5 daily regenerations, token cap) and paid monthly/annual subscriptions via RevenueCat with a single subscription per user.
todos:
  - id: setup-schema
    content: Define subscription_plans, user_subscriptions, trial_usage schemas
    status: completed
  - id: seed-plans
    content: Seed monthly/annual plans with pricing
    status: completed
    dependencies:
      - setup-schema
  - id: service-logic
    content: Implement subscription service logic and limit checks
    status: completed
    dependencies:
      - setup-schema
  - id: middleware-guard
    content: Add middleware to guard generation/regeneration endpoints
    status: completed
    dependencies:
      - service-logic
  - id: controller-hooks
    content: Re-check limits and increment usage in controllers
    status: completed
    dependencies:
      - middleware-guard
  - id: job-regeneration-guard
    content: Ensure job regeneration enforces 5/day trial limit
    status: completed
    dependencies:
      - service-logic
  - id: webhook-handler
    content: Add RevenueCat webhook route/controller with idempotency
    status: completed
    dependencies:
      - setup-schema
  - id: types-responses
    content: Add paywall/limit response types and register routes/models
    status: completed
    dependencies:
      - setup-schema
  - id: tests
    content: Add unit/integration tests for limits and webhooks
    status: pending
    dependencies:
      - service-logic
      - webhook-handler
      - controller-hooks
---

# Simplified Subscription & Trial Plan

## Scope

- Add DB schema for subscription plans, user subscriptions, and trial usage.
- Enforce free-trial limits: 2 weekly generations, 5 daily regenerations (day-plan regen cap), token cap (existing token usage source).
- Enable paid subscriptions (monthly/annual) with one active subscription per user; paid users skip trial limits.
- Wire middleware/guards into workout generation/regeneration only; reading/using existing workouts stays open.

## Database

- Create `src/models/subscription.schema.ts` with tables: `subscription_plans`, `user_subscriptions`, `trial_usage` per provided fields; add unique on `user_subscriptions.user_id` and `trial_usage.user_id`, indexes on status/plan_id.
- Seed/reference plans for monthly/annual pricing (USD cents) via config or migration defaults.

### Subscription DB Schema (detailed)

*Table: subscription_plans*

| Field | Type | Description | Example Values |
| --- | --- | --- | --- |
| id | SERIAL PRIMARY KEY | Internal ID | 1, 2, 3 |
| plan_id | ENUM UNIQUE | RevenueCat product ID | "masters_fit_monthly", "masters_fit_annual" |
| name | VARCHAR(255) | Display name | "Monthly Premium", "Annual Premium" |
| description | TEXT | Plan description | "Unlimited workouts and regenerations" |
| billing_period | ENUM | Billing cycle | "monthly", "annual" |
| price_usd | INTEGER | Price in cents | 999 ($9.99), 7999 ($79.99) |
| is_active | BOOLEAN | Can be purchased | true, false |
| created_at | TIMESTAMP | When created | 2024-01-15 10:00:00Z |
| updated_at | TIMESTAMP | Last modified | 2024-01-15 10:00:00Z |

*Table: user_subscriptions*

| Field | Type | Description | Example Values |
| --- | --- | --- | --- |
| id | SERIAL PRIMARY KEY | Internal ID | 1, 2, 3 |
| user_id | INTEGER | Reference to users table | 123, 456, 789 |
| revenuecat_customer_id | VARCHAR(255) | RevenueCat customer ID | "app_user_123" |
| revenuecat_subscription_id | VARCHAR(255) | RevenueCat subscription ID | "sub_abc123" (null for trial) |
| plan_id | VARCHAR(255) | Which plan user has | "masters_fit_monthly", null for trial |
| status | ENUM | Current subscription state | "trial", "active", "expired", "cancelled" |
| subscription_start_date | TIMESTAMP | When paid subscription started | 2024-01-20 15:30:00Z |
| subscription_end_date | TIMESTAMP | When subscription expires | 2024-02-20 15:30:00Z |
| created_at | TIMESTAMP | Record created | 2024-01-15 10:00:00Z |
| updated_at | TIMESTAMP | Last modified | 2024-01-20 15:30:00Z |

*Table: trial_usage*

| Field | Type | Description | Example Values |
| --- | --- | --- | --- |
| id | SERIAL PRIMARY KEY | Internal ID | 1, 2, 3 |
| user_id | INTEGER | Reference to users table | 123, 456, 789 |
| weekly_generations_count | INTEGER | Workouts generated this week | 0, 1, 2 (max 2 for trial) |
| daily_regenerations_count | INTEGER | Regenerations today | 0, 1, 2, 3, 4, 5 (max 5 for trial) |
| tokens_used | INTEGER | AI tokens used today | 0, 1500, 25000 |
| created_at | TIMESTAMP | Record created | 2024-01-15 10:00:00Z |
| updated_at | TIMESTAMP | Last modified | 2024-01-15 14:20:00Z |

## Application Logic

- `SubscriptionService`: fetch subscription, derive access level (`active` → unlimited, `trial/expired/cancelled` → enforce), check trial limits (weekly generations, daily/day-plan regenerations, token cap), increment usage, and upsert trial rows.
- `SubscriptionMiddleware`: guard generation/regeneration endpoints; block when limits exceeded or subscription required; attach estimated tokens for later increment.
- Controllers (`workout.controller.ts`): on generate/regenerate, re-check limits in transaction and increment trial usage with actual tokens; paid users bypass trial checks.
- Background regen job (`src/jobs/workout-regeneration.job.ts`): ensure regeneration flow respects the 5/day trial cap via the shared subscription checks; if blocked, surface a paywall-type failure and avoid consuming attempts.
- Keep GET/interaction endpoints unrestricted by subscription.

## Webhooks (RevenueCat)

- Add route/controller for RevenueCat webhook; verify signature; handle `INITIAL_PURCHASE/RENEWAL` → set status active, dates; `CANCELLATION` → set cancel_at_period_end; `EXPIRATION` → set expired/cancelled; store webhook events for idempotency.

## Config/Types

- Add request/response types for subscription/paywall responses; expose limits in error payloads.
- Register new routes and export schemas in `src/models/index.ts` and `src/routes/index.ts`.

## Testing

- Unit: limit calculations (weekly/daily/token), subscription state transitions, middleware guard behavior.
- Integration: webhook idempotency, generate/regenerate flows for trial vs paid.

## Implementation Todos

- setup-schema: Define `subscription_plans`, `user_subscriptions`, `trial_usage` schemas with constraints.
- seed-plans: Add monthly/annual plan entries/prices (config or migration seed).
- service-logic: Implement subscription service (access level, limit checks, usage increment, upsert trial rows).
- middleware-guard: Add subscription guard middleware for generation/regeneration endpoints only.
- controller-hooks: Re-check limits in controllers and increment usage with actual tokens.

- webhook-handler: Add RevenueCat webhook route/controller + idempotency store.