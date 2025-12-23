---
name: ""
overview: ""
todos: []
---

# Subscription & Trial Enforcement System

## 1. Database Schema Design

### Tables to Create

**subscription_plans** (`src/models/subscription.schema.ts`)

- `id` (serial, PK)
- `revenue_cat_product_id` (text, unique) - RevenueCat product identifier
- `name` (text) - e.g., "monthly", "annual"
- `billing_period` (text, enum: 'monthly', 'annual')
- `price_usd` (decimal)
- `is_active` (boolean, default true)
- `created_at` (timestamp)
- `updated_at` (timestamp)

**user_subscriptions** (`src/models/subscription.schema.ts`)

- `id` (serial, PK)
- `user_id` (integer, FK → users.id, unique) - One active subscription per user
- `subscription_plan_id` (integer, FK → subscription_plans.id)
- `revenue_cat_subscription_id` (text, unique) - RevenueCat subscription identifier
- `status` (text, enum: 'trial', 'active', 'expired', 'cancelled')
- `current_period_start` (timestamp)
- `current_period_end` (timestamp)
- `cancel_at_period_end` (boolean, default false)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- Indexes: `user_id`, `revenue_cat_subscription_id`, `status`

**trial_usage** (`src/models/subscription.schema.ts`)

- `id` (serial, PK)
- `user_id` (integer, FK → users.id, unique) - One record per user
- `weekly_generations_count` (integer, default 0) - Deprecated: Use workout_generations table for rolling window
- `lifetime_regenerations_count` (integer, default 0) - Total regenerations ever used (lifetime limit: 5)
- `tokens_used` (integer, default 0) - Cumulative token usage (lifetime limit: 50000)
- `created_at` (timestamp)
- `updated_at` (timestamp)
- Index: `user_id`

**Note**: `lifetime_regenerations_count` represents a lifetime limit of 5 total regenerations, not per day. This count never resets automatically (only if subscription becomes active or manual admin reset).

### Constraints

- `user_subscriptions.user_id` UNIQUE constraint (enforced at DB level)
- `trial_usage.user_id` UNIQUE constraint
- Foreign key constraints with CASCADE on user deletion

## 2. Subscription State Model

### Access Model Summary

**Key Principle**: Subscription status controls the ability to CREATE new workout plans, not the ability to ACCESS or USE existing ones.| User State | Generate New Workouts | Regenerate Workouts | Access Existing Workouts | Interact with Workout Data ||------------|----------------------|-------------------|-------------------------|---------------------------|| `trial` | Yes (2/week limit) | Yes (5 lifetime limit) | Yes (all workouts) | Yes (full access) || `active` | Yes (unlimited) | Yes (unlimited) | Yes (all workouts) | Yes (full access) || `expired` | No (paywall) | No (paywall) | Yes (all workouts) | Yes (full access) || `cancelled` | No (paywall) | No (paywall) | Yes (all workouts) | Yes (full access) |**Important**: Expired/cancelled users retain full access to:

- All workout plans generated before expiration (regardless of dates)
- All plan days (past, present, future dates)
- Ability to mark exercises/days as complete
- Ability to log workout progress
- Ability to view analytics and history

Only NEW generation/regeneration operations are blocked.

### State Definitions

| State | Description | Generation Allowed | Regeneration Allowed | Trial Tracking ||-------|-------------|-------------------|---------------------|----------------|| `trial` | No active paid subscription | Yes (2/week rolling) | Yes (5 lifetime total) | Yes || `active` | Valid paid subscription | Yes (unlimited) | Yes (unlimited) | No || `expired` | Subscription period ended | No | No | Yes (blocked) || `cancelled` | User cancelled, period ended | No | No | Yes (blocked) |

### State Transitions

```javascript
trial → active (on subscription purchase)
active → expired (on period end, no renewal)
active → cancelled (user cancels, period ends)
expired → active (on renewal)
cancelled → active (on resubscription)
```



### Effective Access Logic

```typescript
function getEffectiveAccessLevel(subscription: UserSubscription): 'unlimited' | 'trial' | 'blocked' {
  if (subscription.status === 'active') return 'unlimited';
  if (subscription.status === 'trial') return 'trial';
  return 'blocked'; // expired or cancelled
}
```



## 3. Trial Usage Enforcement Logic

### Rolling Window Strategy (7-day)

For weekly generations:

- Track `last_generation_date` timestamps (store in array or use window query)
- Count generations where `last_generation_date >= NOW() - INTERVAL '7 days'`
- Alternative: Store generation timestamps in separate `workout_generations` table with `user_id`, `created_at`

**Recommended Approach**: Create `workout_generations` tracking table:

- `id` (serial, PK)
- `user_id` (integer, FK)
- `workout_id` (integer, FK → workouts.id, nullable)
- `type` (text, enum: 'generation', 'regeneration')
- `tokens_used` (integer)
- `created_at` (timestamp)
- Index: `(user_id, created_at)` for efficient window queries

### Lifetime Regeneration Limit

For regenerations:

- `lifetime_regenerations_count` is a cumulative count that never resets automatically
- Limit: 5 total regenerations per user (lifetime)
- Once limit is reached, no more regenerations allowed until subscription becomes active
- Only resets if:
- User subscribes (subscription becomes active) - for analytics, may keep count but ignore it
- Manual admin reset

### Token Cap Enforcement

- Track cumulative `tokens_used` in `trial_usage` table
- Increment on each generation/regeneration
- Check before allowing operation: `tokens_used < 50000`
- Reset strategy: Only reset if subscription becomes active, or manual admin reset

### Usage Increment Flow

```pseudocode
function incrementTrialUsage(userId, operationType, tokensUsed):
  BEGIN TRANSACTION
    SELECT * FROM trial_usage WHERE user_id = userId FOR UPDATE
    IF no row exists:
      INSERT INTO trial_usage (user_id, ...) VALUES (...)
    
    IF operationType == 'generation':
      -- Check weekly limit (rolling 7-day window)
      count = SELECT COUNT(*) FROM workout_generations 
              WHERE user_id = userId 
              AND type = 'generation'
              AND created_at >= NOW() - INTERVAL '7 days'
      
      IF count >= 2:
        ROLLBACK
        RETURN ERROR: "Weekly generation limit exceeded"
      
      -- Check token cap
      IF trial_usage.tokens_used + tokensUsed > 50000:
        ROLLBACK
        RETURN ERROR: "Token limit exceeded"
      
      -- Increment
      UPDATE trial_usage SET 
        weekly_generations_count = weekly_generations_count + 1,
        last_generation_date = NOW(),
        tokens_used = tokens_used + tokensUsed
      
      INSERT INTO workout_generations (user_id, type, tokens_used, created_at)
      VALUES (userId, 'generation', tokensUsed, NOW())
    
    ELSE IF operationType == 'regeneration':
      -- Check lifetime regeneration limit (5 total, never resets)
      IF trial_usage.lifetime_regenerations_count >= 5:
        ROLLBACK
        RETURN ERROR: "Lifetime regeneration limit exceeded (5 total)"
      
      -- Check token cap
      IF trial_usage.tokens_used + tokensUsed > 50000:
        ROLLBACK
        RETURN ERROR: "Token limit exceeded"
      
      -- Increment lifetime count (never resets automatically)
      UPDATE trial_usage SET 
        lifetime_regenerations_count = lifetime_regenerations_count + 1,
        tokens_used = tokens_used + tokensUsed,
        updated_at = NOW()
      
      INSERT INTO workout_generations (user_id, type, tokens_used, created_at)
      VALUES (userId, 'regeneration', tokensUsed, NOW())
    
  COMMIT
```



## 4. API Enforcement Implementation

### 4.1 Subscription Guard Service

**File**: `src/services/subscription.service.ts`

```typescript
class SubscriptionService {
  async getUserSubscription(userId: number): Promise<UserSubscription | null>
  async getEffectiveAccessLevel(userId: number): Promise<'unlimited' | 'trial' | 'blocked'>
  async checkTrialLimits(userId: number, operation: 'generation' | 'regeneration', estimatedTokens: number): Promise<{ allowed: boolean; reason?: string }>
  async incrementTrialUsage(userId: number, operation: 'generation' | 'regeneration', tokensUsed: number): Promise<void>
}
```



### 4.2 Subscription Middleware

**File**: `src/middleware/subscription.middleware.ts`

```pseudocode
function subscriptionGuard(operation: 'generation' | 'regeneration'):
  async function(req, res, next):
    userId = req.userId
    
    subscription = await subscriptionService.getUserSubscription(userId)
    IF subscription is null:
      -- Create default trial subscription
      subscription = await subscriptionService.createTrialSubscription(userId)
    
    accessLevel = getEffectiveAccessLevel(subscription)
    
    IF accessLevel == 'unlimited':
      -- Skip trial checks, allow request
      req.subscriptionAccess = 'unlimited'
      next()
      RETURN
    
    IF accessLevel == 'blocked':
      RETURN 403 {
        success: false,
        error: "Subscription required",
        paywall: {
          type: "subscription_required",
          message: "Your subscription has expired. Please renew to continue."
        }
      }
    
    -- accessLevel == 'trial'
    -- Check limits before allowing
    estimatedTokens = estimateTokenUsage(req.body) -- from request context
    limitCheck = await subscriptionService.checkTrialLimits(userId, operation, estimatedTokens)
    
    IF limitCheck.allowed == false:
      RETURN 403 {
        success: false,
        error: limitCheck.reason,
        paywall: {
          type: getPaywallType(operation, limitCheck.reason),
          message: getPaywallMessage(operation, limitCheck.reason),
          limits: {
            weeklyGenerations: { used: X, limit: 2 },
            lifetimeRegenerations: { used: Y, limit: 5 },
            tokens: { used: Z, limit: 50000 }
          }
        }
      }
    
    req.subscriptionAccess = 'trial'
    req.estimatedTokens = estimatedTokens
    next()
```



### 4.3 POST /workout/{userId}/generate

**File**: `src/controllers/workout.controller.ts` (modify existing)

```pseudocode
@Post("/{userId}/generate")
async generateWorkoutPlan(userId, requestBody):
  -- Middleware already checked limits, but verify again in transaction
  
  BEGIN TRANSACTION
    -- Double-check limits (race condition protection)
    accessLevel = await subscriptionService.getEffectiveAccessLevel(userId)
    IF accessLevel != 'unlimited':
      limitCheck = await subscriptionService.checkTrialLimits(userId, 'generation', estimatedTokens)
      IF not limitCheck.allowed:
        ROLLBACK
        RETURN 403 with paywall response
    
    -- Generate workout (existing logic)
    workout = await workoutService.generateWorkoutPlan(userId, ...)
    actualTokensUsed = getActualTokensUsed(workout) -- from AI response
    
    -- Increment usage
    IF accessLevel != 'unlimited':
      await subscriptionService.incrementTrialUsage(userId, 'generation', actualTokensUsed)
    
  COMMIT
  
  RETURN { success: true, workout }
```



### 4.4 POST /workout/{userId}/regenerate

**File**: `src/controllers/workout.controller.ts` (modify existing)

```pseudocode
@Post("/{userId}/regenerate")
async regenerateWorkoutPlan(userId, requestBody):
  -- Same pattern as generate, but with 'regeneration' operation
  BEGIN TRANSACTION
    accessLevel = await subscriptionService.getEffectiveAccessLevel(userId)
    IF accessLevel != 'unlimited':
      limitCheck = await subscriptionService.checkTrialLimits(userId, 'regeneration', estimatedTokens)
      IF not limitCheck.allowed:
        ROLLBACK
        RETURN 403 with paywall response
    
    workout = await workoutService.regenerateWorkoutPlan(userId, ...)
    actualTokensUsed = getActualTokensUsed(workout)
    
    IF accessLevel != 'unlimited':
      await subscriptionService.incrementTrialUsage(userId, 'regeneration', actualTokensUsed)
    
  COMMIT
  
  RETURN { success: true, workout }
```



### 4.5 Paywall Response Structure

```typescript
interface PaywallResponse {
  success: false;
  error: string;
  paywall: {
    type: 'weekly_limit_exceeded' | 'lifetime_regeneration_limit_exceeded' | 'token_limit_exceeded' | 'subscription_required';
    message: string;
    limits?: {
      weeklyGenerations: { used: number; limit: number };
      lifetimeRegenerations: { used: number; limit: number };
      tokens: { used: number; limit: number };
    };
  };
}
```



### 4.6 Access to Previously Generated Workout Plans

**Critical Requirement**: Expired/cancelled users must retain full access to all workout plans generated before subscription expiration, regardless of the dates those plans were scheduled for.

#### Workout Plan Structure

- Workouts have `startDate` and `endDate` (text fields)
- Each workout contains multiple `planDays`, each with a specific `date` (text field)
- Plan days are scheduled for specific dates (e.g., "2024-01-15", "2024-01-16")
- These dates may be in the past, present, or future relative to subscription expiration

#### Access Model for Expired Users

**Allowed Operations (No Subscription Check Required):**

1. **Read Operations** - All GET endpoints remain accessible:

- `GET /workouts/{userId}` - List all workouts (past, present, future dates)
- `GET /workouts/{userId}/active` - Get active workouts
- `GET /workouts/{userId}/history` - Get workout history
- `GET /workouts/{id}` - Get specific workout with all plan days
- `GET /workouts/{userId}/active-workout` - Get current active workout
- Any endpoint that retrieves workout data

2. **Data Interaction Operations** - Users can interact with existing workout data:

- Mark plan days as complete (`PUT /plan-days/{id}` or similar)
- Mark exercises as complete (`PUT /plan-day-exercises/{id}` or similar)
- Log workout completion data (`POST /logs` endpoints)
- Update workout progress (completion status, notes, etc.)
- View analytics and progress for existing workouts

**Blocked Operations (Subscription Check Required):**

1. **Generation Operations** - Only NEW generation/regeneration is blocked:

- `POST /workouts/{userId}/generate` - Generate NEW workout plan
- `POST /workouts/{userId}/regenerate` - Regenerate existing workout
- `POST /workouts/{userId}/regenerate-async` - Async regeneration
- `POST /workouts/{userId}/rest-day-workout` - Generate rest day workout

#### Implementation Pattern

```pseudocode
// Route configuration - selective middleware application

// GET endpoints - NO subscription middleware (always accessible)
router.get("/:userId", async (req, res) => {
  await expressAuthentication(req, "bearerAuth"); // Only auth required
  const response = await controller.getUserWorkouts(Number(req.params.userId));
  res.json(response);
});

router.get("/:userId/active", async (req, res) => {
  await expressAuthentication(req, "bearerAuth");
  const response = await controller.getActiveWorkouts(Number(req.params.userId));
  res.json(response);
});

// Data interaction endpoints - NO subscription middleware
router.put("/plan-days/:id", async (req, res) => {
  await expressAuthentication(req, "bearerAuth");
  // Allow updating existing plan day (mark complete, etc.)
  const response = await controller.updatePlanDay(Number(req.params.id), req.body);
  res.json(response);
});

router.post("/logs", async (req, res) => {
  await expressAuthentication(req, "bearerAuth");
  // Allow logging workout completion for existing workouts
  const response = await controller.createLog(req.body);
  res.json(response);
});

// Generation endpoints - WITH subscription middleware (blocks expired users)
router.post("/:userId/generate", 
  subscriptionGuard('generation'),  // <-- Blocks expired/cancelled users
  async (req, res) => {
    const response = await controller.generateWorkoutPlan(Number(req.params.userId), req.body);
    res.json(response);
  }
);

router.post("/:userId/regenerate", 
  subscriptionGuard('regeneration'),  // <-- Blocks expired/cancelled users
  async (req, res) => {
    const response = await controller.regenerateWorkoutPlan(Number(req.params.userId), req.body);
    res.json(response);
  }
);
```



#### Date-Based Access Logic

**No Date Filtering for Expired Users:**

- Expired users can access workout plans regardless of:
- Whether plan day dates are in the past
- Whether plan day dates are in the future
- Whether the workout's `startDate`/`endDate` have passed
- How long ago the workout was generated

**Example Scenarios:**

1. **User generates 4-week plan (Jan 1-28) on Dec 20, subscription expires Jan 5:**

- User can access all 4 weeks of the plan (including weeks 2-4 with future dates)
- User can mark days as complete, log progress, view exercises
- User cannot generate a new plan or regenerate the existing one

2. **User generates 2-week plan (Jan 1-14) on Dec 15, subscription expires Jan 20:**

- User can still access the entire plan (even though dates have passed)
- User can mark past days as complete retroactively
- User can view all historical workout data

3. **User has multiple workout plans from different time periods:**

- All previously generated plans remain accessible
- No filtering based on subscription status or date ranges
- User can switch between any of their workout plans

#### Database Query Considerations

**No Subscription-Based Filtering in Queries:**

```pseudocode
// In workout.service.ts - getUserWorkouts()
async getUserWorkouts(userId: number): Promise<WorkoutWithDetails[]> {
  // NO subscription check - return ALL workouts for user
  const userWorkouts = await this.db.query.workouts.findMany({
    where: eq(workouts.userId, userId),  // Only filter by userId
    with: {
      planDays: {
        // Include ALL plan days regardless of date
        with: {
          blocks: {
            with: {
              exercises: {
                with: {
                  exercise: true,
                },
              },
            },
          },
        },
      },
    },
  });
  
  return userWorkouts; // Return all workouts, no date filtering
}
```

**Key Principle**: Subscription status only affects the ability to CREATE new workout plans, not the ability to ACCESS or USE existing ones.

## 5. RevenueCat Webhook Handling

### 5.1 Webhook Endpoint

**File**: `src/routes/subscription.routes.ts` (new)**File**: `src/controllers/subscription.controller.ts` (new)

```pseudocode
@Post("/webhooks/revenuecat")
async handleRevenueCatWebhook(req, res):
  signature = req.headers['authorization']
  IF not verifyRevenueCatSignature(req.body, signature):
    RETURN 401
  
  event = req.body.event
  eventType = event.type
  
  -- Idempotency: Check if event already processed
  eventId = event.id
  IF await isEventProcessed(eventId):
    RETURN 200 -- Already processed
  
  BEGIN TRANSACTION
    TRY:
      IF eventType == 'INITIAL_PURCHASE' OR eventType == 'RENEWAL':
        await handleSubscriptionActivated(event)
      ELSE IF eventType == 'CANCELLATION':
        await handleSubscriptionCancelled(event)
      ELSE IF eventType == 'EXPIRATION':
        await handleSubscriptionExpired(event)
      ELSE IF eventType == 'BILLING_ISSUE':
        await handleBillingIssue(event)
      
      -- Mark event as processed
      INSERT INTO webhook_events (event_id, event_type, processed_at)
      VALUES (eventId, eventType, NOW())
      
      COMMIT
    CATCH error:
      ROLLBACK
      LOG error
      RETURN 500
```



### 5.2 Webhook Handlers

**File**: `src/services/subscription.service.ts`

```pseudocode
function handleSubscriptionActivated(event):
  userId = findUserByRevenueCatCustomerId(event.app_user_id)
  subscriptionPlan = findPlanByRevenueCatProductId(event.product_id)
  
  -- Upsert subscription (handle race conditions)
  INSERT INTO user_subscriptions (
    user_id, subscription_plan_id, revenue_cat_subscription_id,
    status, current_period_start, current_period_end
  ) VALUES (
    userId, subscriptionPlan.id, event.subscription_id,
    'active', event.purchased_at, event.expires_at
  )
  ON CONFLICT (user_id) DO UPDATE SET
    subscription_plan_id = EXCLUDED.subscription_plan_id,
    revenue_cat_subscription_id = EXCLUDED.revenue_cat_subscription_id,
    status = 'active',
    current_period_start = EXCLUDED.current_period_start,
    current_period_end = EXCLUDED.current_period_end,
    cancel_at_period_end = false,
    updated_at = NOW()

function handleSubscriptionCancelled(event):
  UPDATE user_subscriptions
  SET cancel_at_period_end = true,
      updated_at = NOW()
  WHERE revenue_cat_subscription_id = event.subscription_id

function handleSubscriptionExpired(event):
  UPDATE user_subscriptions
  SET status = CASE
    WHEN cancel_at_period_end THEN 'cancelled'
    ELSE 'expired'
  END,
  updated_at = NOW()
  WHERE revenue_cat_subscription_id = event.subscription_id
```



### 5.3 Webhook Event Tracking

**Table**: `webhook_events`

- `id` (serial, PK)
- `event_id` (text, unique) - RevenueCat event ID
- `event_type` (text)
- `processed_at` (timestamp)
- `payload` (jsonb) - Store full event for debugging
- Index: `event_id`

## 6. Data Integrity & Constraints

### 6.1 Database Constraints

```sql
-- Ensure one subscription per user
ALTER TABLE user_subscriptions 
ADD CONSTRAINT unique_user_subscription UNIQUE (user_id);

-- Ensure one trial_usage record per user
ALTER TABLE trial_usage 
ADD CONSTRAINT unique_user_trial_usage UNIQUE (user_id);

-- Foreign key constraints
ALTER TABLE user_subscriptions 
ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;

ALTER TABLE trial_usage 
ADD CONSTRAINT fk_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
```



### 6.2 Race Condition Handling

**Strategy**: Use PostgreSQL `SELECT ... FOR UPDATE` with row-level locking

```pseudocode
BEGIN TRANSACTION
  -- Lock user_subscriptions row
  subscription = SELECT * FROM user_subscriptions 
                 WHERE user_id = userId 
                 FOR UPDATE
  
  -- Lock trial_usage row
  trialUsage = SELECT * FROM trial_usage 
               WHERE user_id = userId 
               FOR UPDATE
  
  -- Perform checks and updates
  ...
COMMIT
```



### 6.3 Transaction Boundaries

- **Workout Generation**: Single transaction wrapping limit check + generation + usage increment
- **Usage Increment**: Always within transaction with `FOR UPDATE` locks
- **Webhook Processing**: Single transaction for event processing + subscription update

### 6.4 Retry Behavior

- **Idempotent Operations**: Webhook events, usage increments (check before increment)
- **Non-Idempotent**: Workout generation (already handled by job queue with retry logic)

## 7. Edge Case Handling

### 7.1 User Subscribes Mid-Trial

**Scenario**: User has used 1/2 weekly generations, then subscribes**Solution**:

- On subscription activation webhook, set `status = 'active'`
- Trial limits no longer checked (accessLevel = 'unlimited')
- Existing `trial_usage` record remains but is ignored
- No reset of usage counts (for analytics purposes)

### 7.2 Subscription Expires but User Has Previously Generated Workouts

**Scenario**: User's subscription expires (or trial limits exceeded), but they have workout plans with specific dates that were generated before expiration**Solution**:

- **Blocked**: All generation/regeneration endpoints return paywall
- `POST /workouts/{userId}/generate` - Blocked
- `POST /workouts/{userId}/regenerate` - Blocked
- `POST /workouts/{userId}/regenerate-async` - Blocked
- **Allowed**: Full access to all previously generated workout data:
- `GET /workouts/{userId}` - Access all workouts (past, present, future dates)
- `GET /workouts/{userId}/active` - Access active workouts
- `GET /workouts/{id}` - Access specific workout with all plan days
- `PUT /plan-days/{id}` - Mark plan days as complete
- `PUT /plan-day-exercises/{id}` - Mark exercises as complete
- `POST /logs` - Log workout completion data
- Any endpoint that reads or updates existing workout data
- **Date Independence**: 
- Users can access workout plans regardless of whether plan day dates are in the past or future
- No filtering based on subscription expiration date
- All workout plans generated before expiration remain fully accessible
- **Data Persistence**:
- No workout data is deleted or modified when subscription expires
- Users can continue using their workout plans indefinitely
- Progress tracking, completion status, and logs remain accessible

### 7.3 Subscription Expires → Revert to Blocked State (But Keep Existing Workouts)

**Scenario**: Active subscription expires, no renewal**Solution**:

- Webhook sets `status = 'expired'`
- `getEffectiveAccessLevel()` returns 'blocked'
- All generation/regeneration requests return paywall
- **However**: All previously generated workout plans remain fully accessible
- User can view all workouts (including those with future dates)
- User can mark days/exercises as complete
- User can log workout progress
- User can view analytics for existing workouts
- User must resubscribe to generate NEW workout plans
- Existing workout data is never deleted or restricted based on subscription status

### 7.4 Webhook Delay Causing Temporary Desync

**Scenario**: Subscription renewed in RevenueCat, but webhook delayed**Solution**:

- Implement webhook retry mechanism (RevenueCat retries)
- Add manual sync endpoint (admin-only): `POST /admin/subscriptions/{userId}/sync`
- Consider periodic sync job (optional): Query RevenueCat API for active subscriptions

### 7.5 Concurrent Requests Hitting Limits

**Scenario**: Two requests simultaneously check limits, both pass, both increment**Solution**:

- Use `SELECT ... FOR UPDATE` in transaction
- Check limits again after acquiring lock
- Second request will see updated count and be blocked

## 8. Implementation Files

### New Files to Create

1. `src/models/subscription.schema.ts` - Database schemas
2. `src/services/subscription.service.ts` - Core subscription logic
3. `src/middleware/subscription.middleware.ts` - Request guard
4. `src/controllers/subscription.controller.ts` - Webhook handler
5. `src/routes/subscription.routes.ts` - Webhook routes
6. `src/types/subscription/requests.ts` - Request types
7. `src/types/subscription/responses.ts` - Response types

### Files to Modify

1. `src/controllers/workout.controller.ts` - Add subscription checks
2. `src/services/workout.service.ts` - Integrate token tracking
3. `src/models/index.ts` - Export subscription schemas
4. `src/routes/index.ts` - Register subscription routes

## 9. Token Tracking Integration

### Where to Track Tokens

**File**: `src/services/workout-agent.service.ts` (modify)

- After LLM API call, extract token usage from response
- Return token count to caller
- Caller (workout.service) passes to subscription service

**File**: `src/services/workout.service.ts` (modify)

- Capture token usage from `workoutAgentService.generateWorkout()` response
- Pass to `subscriptionService.incrementTrialUsage()`

## 10. Testing Considerations

### Unit Tests

- Subscription state transitions
- Trial limit calculations (rolling window)
- Token cap enforcement
- Concurrent request handling

### Integration Tests

- Webhook processing (idempotency)
- End-to-end generation with limits
- Subscription activation flow

### Load Tests

- Concurrent generation requests
- Webhook burst handling