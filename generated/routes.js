/* tslint:disable */
/* eslint-disable */
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { ValidationService, ValidateError, fetchMiddlewares } from '@tsoa/runtime';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { AuthController } from './../src/controllers/auth.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { ExerciseController } from './../src/controllers/exercise.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { LogsController } from './../src/controllers/logs.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { ProfileController } from './../src/controllers/profile.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { PromptsController } from './../src/controllers/prompts.controller';
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
import { WorkoutController } from './../src/controllers/workout.controller';
import { expressAuthentication } from './../src/middleware/auth.middleware';
// @ts-ignore - no great way to install types from subpackage
const promiseAny = require('promise.any');
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
const models = {
    "AuthUserResponse": {
        "dataType": "refObject",
        "properties": {
            "id": { "dataType": "double", "required": true },
            "email": { "dataType": "string", "required": true },
            "name": { "dataType": "string", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AuthVerifyResponse": {
        "dataType": "refObject",
        "properties": {
            "success": { "dataType": "boolean", "required": true },
            "error": { "dataType": "string" },
            "needsOnboarding": { "dataType": "boolean" },
            "user": { "ref": "AuthUserResponse" },
            "email": { "dataType": "string" },
            "token": { "dataType": "string" },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "EmailAuthRequest": {
        "dataType": "refObject",
        "properties": {
            "email": { "dataType": "string", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AuthLoginResponse": {
        "dataType": "refObject",
        "properties": {
            "success": { "dataType": "boolean", "required": true },
            "error": { "dataType": "string" },
            "message": { "dataType": "string" },
            "authCode": { "dataType": "string" },
            "userExists": { "dataType": "boolean" },
            "needsOnboarding": { "dataType": "boolean" },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "AuthCodeRequest": {
        "dataType": "refObject",
        "properties": {
            "authCode": { "dataType": "string", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Exercise": {
        "dataType": "refObject",
        "properties": {
            "id": { "dataType": "double", "required": true },
            "name": { "dataType": "string", "required": true },
            "description": { "dataType": "string" },
            "category": { "dataType": "string", "required": true },
            "difficulty": { "dataType": "string", "required": true },
            "equipment": { "dataType": "string" },
            "instructions": { "dataType": "string" },
            "muscles_targeted": { "dataType": "array", "array": { "dataType": "string" } },
            "created_at": { "dataType": "datetime", "required": true },
            "updated_at": { "dataType": "datetime", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ExercisesResponse": {
        "dataType": "refObject",
        "properties": {
            "success": { "dataType": "boolean", "required": true },
            "error": { "dataType": "string" },
            "exercises": { "dataType": "array", "array": { "dataType": "refObject", "ref": "Exercise" }, "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ExerciseResponse": {
        "dataType": "refObject",
        "properties": {
            "success": { "dataType": "boolean", "required": true },
            "error": { "dataType": "string" },
            "exercise": { "ref": "Exercise", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ApiResponse": {
        "dataType": "refObject",
        "properties": {
            "success": { "dataType": "boolean", "required": true },
            "error": { "dataType": "string" },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ExerciseLog": {
        "dataType": "refObject",
        "properties": {
            "id": { "dataType": "double", "required": true },
            "planDayExerciseId": { "dataType": "double", "required": true },
            "setsCompleted": { "dataType": "double", "required": true },
            "repsCompleted": { "dataType": "double", "required": true },
            "weightUsed": { "dataType": "double", "required": true },
            "status": { "dataType": "string", "required": true },
            "notes": { "dataType": "union", "subSchemas": [{ "dataType": "string" }, { "dataType": "enum", "enums": [null] }], "required": true },
            "createdAt": { "dataType": "datetime", "required": true },
            "updatedAt": { "dataType": "datetime", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ExerciseLogsResponse": {
        "dataType": "refObject",
        "properties": {
            "success": { "dataType": "boolean", "required": true },
            "error": { "dataType": "string" },
            "logs": { "dataType": "array", "array": { "dataType": "refObject", "ref": "ExerciseLog" }, "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Gender": {
        "dataType": "refAlias",
        "type": { "dataType": "union", "subSchemas": [{ "dataType": "enum", "enums": ["male"] }, { "dataType": "enum", "enums": ["female"] }, { "dataType": "enum", "enums": ["other"] }], "validators": {} },
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FitnessGoal": {
        "dataType": "refAlias",
        "type": { "dataType": "union", "subSchemas": [{ "dataType": "enum", "enums": ["weight_loss"] }, { "dataType": "enum", "enums": ["muscle_gain"] }, { "dataType": "enum", "enums": ["strength"] }, { "dataType": "enum", "enums": ["endurance"] }, { "dataType": "enum", "enums": ["flexibility"] }, { "dataType": "enum", "enums": ["general_fitness"] }, { "dataType": "enum", "enums": ["mobility"] }, { "dataType": "enum", "enums": ["balance"] }, { "dataType": "enum", "enums": ["recovery"] }], "validators": {} },
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "FitnessLevel": {
        "dataType": "refAlias",
        "type": { "dataType": "union", "subSchemas": [{ "dataType": "enum", "enums": ["beginner"] }, { "dataType": "enum", "enums": ["intermediate"] }, { "dataType": "enum", "enums": ["advanced"] }], "validators": {} },
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PhysicalLimitation": {
        "dataType": "refAlias",
        "type": { "dataType": "union", "subSchemas": [{ "dataType": "enum", "enums": ["knee_pain"] }, { "dataType": "enum", "enums": ["shoulder_pain"] }, { "dataType": "enum", "enums": ["lower_back_pain"] }, { "dataType": "enum", "enums": ["neck_pain"] }, { "dataType": "enum", "enums": ["hip_pain"] }, { "dataType": "enum", "enums": ["ankle_instability"] }, { "dataType": "enum", "enums": ["wrist_pain"] }, { "dataType": "enum", "enums": ["elbow_pain"] }, { "dataType": "enum", "enums": ["arthritis"] }, { "dataType": "enum", "enums": ["osteoporosis"] }, { "dataType": "enum", "enums": ["sciatica"] }, { "dataType": "enum", "enums": ["limited_range_of_motion"] }, { "dataType": "enum", "enums": ["post_surgery_recovery"] }, { "dataType": "enum", "enums": ["balance_issues"] }, { "dataType": "enum", "enums": ["chronic_fatigue"] }, { "dataType": "enum", "enums": ["breathing_issues"] }], "validators": {} },
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Profile": {
        "dataType": "refObject",
        "properties": {
            "id": { "dataType": "double", "required": true },
            "userId": { "dataType": "double", "required": true },
            "height": { "dataType": "double" },
            "weight": { "dataType": "double" },
            "age": { "dataType": "double" },
            "gender": { "ref": "Gender" },
            "fitnessGoals": { "dataType": "array", "array": { "dataType": "refAlias", "ref": "FitnessGoal" } },
            "activityLevel": { "ref": "FitnessLevel" },
            "dietaryRestrictions": { "dataType": "array", "array": { "dataType": "refAlias", "ref": "PhysicalLimitation" } },
            "medicalConditions": { "dataType": "array", "array": { "dataType": "string" } },
            "created_at": { "dataType": "datetime", "required": true },
            "updated_at": { "dataType": "datetime", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "ProfileResponse": {
        "dataType": "refObject",
        "properties": {
            "success": { "dataType": "boolean", "required": true },
            "error": { "dataType": "string" },
            "profile": { "ref": "Profile", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Partial_Profile_": {
        "dataType": "refAlias",
        "type": { "dataType": "nestedObjectLiteral", "nestedProperties": { "id": { "dataType": "double" }, "userId": { "dataType": "double" }, "height": { "dataType": "double" }, "weight": { "dataType": "double" }, "age": { "dataType": "double" }, "gender": { "ref": "Gender" }, "fitnessGoals": { "dataType": "array", "array": { "dataType": "refAlias", "ref": "FitnessGoal" } }, "activityLevel": { "ref": "FitnessLevel" }, "dietaryRestrictions": { "dataType": "array", "array": { "dataType": "refAlias", "ref": "PhysicalLimitation" } }, "medicalConditions": { "dataType": "array", "array": { "dataType": "string" } }, "created_at": { "dataType": "datetime" }, "updated_at": { "dataType": "datetime" } }, "validators": {} },
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Prompt": {
        "dataType": "refObject",
        "properties": {
            "id": { "dataType": "double", "required": true },
            "userId": { "dataType": "double", "required": true },
            "prompt": { "dataType": "string", "required": true },
            "response": { "dataType": "string", "required": true },
            "created_at": { "dataType": "datetime", "required": true },
            "updated_at": { "dataType": "datetime", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "UserPromptsResponse": {
        "dataType": "refObject",
        "properties": {
            "success": { "dataType": "boolean", "required": true },
            "error": { "dataType": "string" },
            "prompts": { "dataType": "array", "array": { "dataType": "refObject", "ref": "Prompt" }, "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CreatePromptResponse": {
        "dataType": "refObject",
        "properties": {
            "success": { "dataType": "boolean", "required": true },
            "error": { "dataType": "string" },
            "prompt": { "ref": "Prompt", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CreatePromptRequest": {
        "dataType": "refObject",
        "properties": {
            "userId": { "dataType": "double", "required": true },
            "prompt": { "dataType": "string", "required": true },
            "response": { "dataType": "string", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PlanDayWithExercise": {
        "dataType": "refObject",
        "properties": {
            "id": { "dataType": "double", "required": true },
            "planDayId": { "dataType": "double", "required": true },
            "exerciseId": { "dataType": "double", "required": true },
            "sets": { "dataType": "double" },
            "reps": { "dataType": "double" },
            "weight": { "dataType": "double" },
            "duration": { "dataType": "double" },
            "restTime": { "dataType": "double" },
            "completed": { "dataType": "boolean", "required": true },
            "notes": { "dataType": "string" },
            "created_at": { "dataType": "datetime", "required": true },
            "updated_at": { "dataType": "datetime", "required": true },
            "exercise": { "ref": "Exercise", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PlanDayWithExercises": {
        "dataType": "refObject",
        "properties": {
            "id": { "dataType": "double", "required": true },
            "workoutId": { "dataType": "double", "required": true },
            "date": { "dataType": "datetime", "required": true },
            "name": { "dataType": "string", "required": true },
            "description": { "dataType": "string" },
            "dayNumber": { "dataType": "double", "required": true },
            "exercises": { "dataType": "array", "array": { "dataType": "refObject", "ref": "PlanDayWithExercise" }, "required": true },
            "created_at": { "dataType": "datetime", "required": true },
            "updated_at": { "dataType": "datetime", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WorkoutWithDetails": {
        "dataType": "refObject",
        "properties": {
            "id": { "dataType": "double", "required": true },
            "userId": { "dataType": "double", "required": true },
            "name": { "dataType": "string", "required": true },
            "description": { "dataType": "string" },
            "startDate": { "dataType": "datetime", "required": true },
            "endDate": { "dataType": "datetime", "required": true },
            "promptId": { "dataType": "double", "required": true },
            "duration": { "dataType": "double" },
            "isActive": { "dataType": "boolean", "required": true },
            "completed": { "dataType": "boolean", "required": true },
            "created_at": { "dataType": "datetime", "required": true },
            "updated_at": { "dataType": "datetime", "required": true },
            "planDays": { "dataType": "array", "array": { "dataType": "refObject", "ref": "PlanDayWithExercises" }, "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WorkoutsResponse": {
        "dataType": "refObject",
        "properties": {
            "success": { "dataType": "boolean", "required": true },
            "error": { "dataType": "string" },
            "workouts": { "dataType": "array", "array": { "dataType": "refObject", "ref": "WorkoutWithDetails" }, "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "WorkoutResponse": {
        "dataType": "refObject",
        "properties": {
            "success": { "dataType": "boolean", "required": true },
            "error": { "dataType": "string" },
            "workout": { "ref": "WorkoutWithDetails", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CreateWorkoutRequest": {
        "dataType": "refObject",
        "properties": {
            "userId": { "dataType": "double", "required": true },
            "startDate": { "dataType": "string", "required": true },
            "endDate": { "dataType": "string", "required": true },
            "promptId": { "dataType": "double", "required": true },
            "name": { "dataType": "string", "required": true },
            "description": { "dataType": "string" },
            "duration": { "dataType": "double" },
            "completed": { "dataType": "boolean" },
            "isActive": { "dataType": "boolean" },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Partial_InsertWorkout_": {
        "dataType": "refAlias",
        "type": { "dataType": "nestedObjectLiteral", "nestedProperties": { "userId": { "dataType": "any" }, "name": { "dataType": "string" }, "description": { "dataType": "string" }, "startDate": { "dataType": "any" }, "endDate": { "dataType": "any" }, "updatedAt": { "dataType": "any" }, "promptId": { "dataType": "any" }, "isActive": { "dataType": "any" }, "duration": { "dataType": "any" }, "completed": { "dataType": "any" } }, "validators": {} },
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PlanDayResponse": {
        "dataType": "refObject",
        "properties": {
            "success": { "dataType": "boolean", "required": true },
            "error": { "dataType": "string" },
            "planDay": { "ref": "PlanDayWithExercises", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CreatePlanDayRequest": {
        "dataType": "refObject",
        "properties": {
            "workoutId": { "dataType": "double", "required": true },
            "date": { "dataType": "string", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "PlanDayExerciseResponse": {
        "dataType": "refObject",
        "properties": {
            "success": { "dataType": "boolean", "required": true },
            "error": { "dataType": "string" },
            "planDayExercise": { "ref": "PlanDayWithExercise", "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "CreatePlanDayExerciseRequest": {
        "dataType": "refObject",
        "properties": {
            "planDayId": { "dataType": "double", "required": true },
            "exerciseId": { "dataType": "double", "required": true },
            "sets": { "dataType": "union", "subSchemas": [{ "dataType": "double" }, { "dataType": "enum", "enums": [null] }], "required": true },
            "reps": { "dataType": "union", "subSchemas": [{ "dataType": "double" }, { "dataType": "enum", "enums": [null] }], "required": true },
            "weight": { "dataType": "union", "subSchemas": [{ "dataType": "double" }, { "dataType": "enum", "enums": [null] }], "required": true },
            "duration": { "dataType": "union", "subSchemas": [{ "dataType": "double" }, { "dataType": "enum", "enums": [null] }], "required": true },
            "restTime": { "dataType": "union", "subSchemas": [{ "dataType": "double" }, { "dataType": "enum", "enums": [null] }], "required": true },
            "completed": { "dataType": "union", "subSchemas": [{ "dataType": "boolean" }, { "dataType": "enum", "enums": [null] }], "required": true },
        },
        "additionalProperties": false,
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    "Partial_InsertPlanDayExercise_": {
        "dataType": "refAlias",
        "type": { "dataType": "nestedObjectLiteral", "nestedProperties": { "weight": { "dataType": "any" }, "createdAt": { "dataType": "any" }, "updatedAt": { "dataType": "any" }, "duration": { "dataType": "any" }, "completed": { "dataType": "any" }, "planDayId": { "dataType": "any" }, "exerciseId": { "dataType": "any" }, "sets": { "dataType": "any" }, "reps": { "dataType": "any" }, "restTime": { "dataType": "any" } }, "validators": {} },
    },
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
};
const validationService = new ValidationService(models);
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
export function RegisterRoutes(app) {
    // ###########################################################################################################
    //  NOTE: If you do not see routes for all of your controllers in this file, then you might not have informed tsoa of where to look
    //      Please look into the "controllerPathGlobs" config option described in the readme: https://github.com/lukeautry/tsoa
    // ###########################################################################################################
    app.post('/auth/check-email', ...(fetchMiddlewares(AuthController)), ...(fetchMiddlewares(AuthController.prototype.checkEmail)), function AuthController_checkEmail(request, response, next) {
        const args = {
            requestBody: { "in": "body", "name": "requestBody", "required": true, "ref": "EmailAuthRequest" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new AuthController();
            const promise = controller.checkEmail.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 200, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.post('/auth/login', ...(fetchMiddlewares(AuthController)), ...(fetchMiddlewares(AuthController.prototype.login)), function AuthController_login(request, response, next) {
        const args = {
            requestBody: { "in": "body", "name": "requestBody", "required": true, "ref": "EmailAuthRequest" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new AuthController();
            const promise = controller.login.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 200, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.post('/auth/verify', ...(fetchMiddlewares(AuthController)), ...(fetchMiddlewares(AuthController.prototype.verify)), function AuthController_verify(request, response, next) {
        const args = {
            requestBody: { "in": "body", "name": "requestBody", "required": true, "ref": "AuthCodeRequest" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new AuthController();
            const promise = controller.verify.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 200, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.get('/exercises', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(ExerciseController)), ...(fetchMiddlewares(ExerciseController.prototype.getExercises)), function ExerciseController_getExercises(request, response, next) {
        const args = {};
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new ExerciseController();
            const promise = controller.getExercises.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 200, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.get('/exercises/:id', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(ExerciseController)), ...(fetchMiddlewares(ExerciseController.prototype.getExercise)), function ExerciseController_getExercise(request, response, next) {
        const args = {
            id: { "in": "path", "name": "id", "required": true, "dataType": "double" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new ExerciseController();
            const promise = controller.getExercise.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 200, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.post('/exercises', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(ExerciseController)), ...(fetchMiddlewares(ExerciseController.prototype.createExercise)), function ExerciseController_createExercise(request, response, next) {
        const args = {
            requestBody: { "in": "body", "name": "requestBody", "required": true, "dataType": "any" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new ExerciseController();
            const promise = controller.createExercise.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 201, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.put('/exercises/:id', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(ExerciseController)), ...(fetchMiddlewares(ExerciseController.prototype.updateExercise)), function ExerciseController_updateExercise(request, response, next) {
        const args = {
            id: { "in": "path", "name": "id", "required": true, "dataType": "double" },
            requestBody: { "in": "body", "name": "requestBody", "required": true, "dataType": "any" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new ExerciseController();
            const promise = controller.updateExercise.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 200, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.delete('/exercises/:id', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(ExerciseController)), ...(fetchMiddlewares(ExerciseController.prototype.deleteExercise)), function ExerciseController_deleteExercise(request, response, next) {
        const args = {
            id: { "in": "path", "name": "id", "required": true, "dataType": "double" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new ExerciseController();
            const promise = controller.deleteExercise.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 200, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.post('/logs', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(LogsController)), ...(fetchMiddlewares(LogsController.prototype.createExerciseLog)), function LogsController_createExerciseLog(request, response, next) {
        const args = {
            requestBody: { "in": "body", "name": "requestBody", "required": true, "dataType": "any" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new LogsController();
            const promise = controller.createExerciseLog.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 201, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.get('/logs/:planDayId', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(LogsController)), ...(fetchMiddlewares(LogsController.prototype.getExerciseLogsForPlanDay)), function LogsController_getExerciseLogsForPlanDay(request, response, next) {
        const args = {
            planDayId: { "in": "path", "name": "planDayId", "required": true, "dataType": "double" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new LogsController();
            const promise = controller.getExerciseLogsForPlanDay.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 200, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.get('/profile/:userId', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(ProfileController)), ...(fetchMiddlewares(ProfileController.prototype.getProfile)), function ProfileController_getProfile(request, response, next) {
        const args = {
            userId: { "in": "path", "name": "userId", "required": true, "dataType": "double" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new ProfileController();
            const promise = controller.getProfile.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 200, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.post('/profile', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(ProfileController)), ...(fetchMiddlewares(ProfileController.prototype.createProfile)), function ProfileController_createProfile(request, response, next) {
        const args = {
            requestBody: { "in": "body", "name": "requestBody", "required": true, "ref": "Partial_Profile_" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new ProfileController();
            const promise = controller.createProfile.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 201, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.put('/profile/:id', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(ProfileController)), ...(fetchMiddlewares(ProfileController.prototype.updateProfile)), function ProfileController_updateProfile(request, response, next) {
        const args = {
            id: { "in": "path", "name": "id", "required": true, "dataType": "double" },
            requestBody: { "in": "body", "name": "requestBody", "required": true, "ref": "Partial_Profile_" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new ProfileController();
            const promise = controller.updateProfile.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 200, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.get('/prompts/:userId', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(PromptsController)), ...(fetchMiddlewares(PromptsController.prototype.getUserPrompts)), function PromptsController_getUserPrompts(request, response, next) {
        const args = {
            userId: { "in": "path", "name": "userId", "required": true, "dataType": "double" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new PromptsController();
            const promise = controller.getUserPrompts.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 200, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.post('/prompts', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(PromptsController)), ...(fetchMiddlewares(PromptsController.prototype.createPrompt)), function PromptsController_createPrompt(request, response, next) {
        const args = {
            requestBody: { "in": "body", "name": "requestBody", "required": true, "ref": "CreatePromptRequest" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new PromptsController();
            const promise = controller.createPrompt.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 201, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.get('/workouts/:userId', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(WorkoutController)), ...(fetchMiddlewares(WorkoutController.prototype.getUserWorkouts)), function WorkoutController_getUserWorkouts(request, response, next) {
        const args = {
            userId: { "in": "path", "name": "userId", "required": true, "dataType": "double" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new WorkoutController();
            const promise = controller.getUserWorkouts.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 200, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.get('/workouts/:userId/active', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(WorkoutController)), ...(fetchMiddlewares(WorkoutController.prototype.getActiveWorkouts)), function WorkoutController_getActiveWorkouts(request, response, next) {
        const args = {
            userId: { "in": "path", "name": "userId", "required": true, "dataType": "double" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new WorkoutController();
            const promise = controller.getActiveWorkouts.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 200, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.post('/workouts/:userId', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(WorkoutController)), ...(fetchMiddlewares(WorkoutController.prototype.createWorkout)), function WorkoutController_createWorkout(request, response, next) {
        const args = {
            userId: { "in": "path", "name": "userId", "required": true, "dataType": "double" },
            requestBody: { "in": "body", "name": "requestBody", "required": true, "ref": "CreateWorkoutRequest" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new WorkoutController();
            const promise = controller.createWorkout.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 201, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.put('/workouts/:id', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(WorkoutController)), ...(fetchMiddlewares(WorkoutController.prototype.updateWorkout)), function WorkoutController_updateWorkout(request, response, next) {
        const args = {
            id: { "in": "path", "name": "id", "required": true, "dataType": "double" },
            requestBody: { "in": "body", "name": "requestBody", "required": true, "ref": "Partial_InsertWorkout_" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new WorkoutController();
            const promise = controller.updateWorkout.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 200, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.post('/workouts/:workoutId/days', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(WorkoutController)), ...(fetchMiddlewares(WorkoutController.prototype.createPlanDay)), function WorkoutController_createPlanDay(request, response, next) {
        const args = {
            workoutId: { "in": "path", "name": "workoutId", "required": true, "dataType": "double" },
            requestBody: { "in": "body", "name": "requestBody", "required": true, "ref": "CreatePlanDayRequest" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new WorkoutController();
            const promise = controller.createPlanDay.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 201, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.post('/workouts/days/:planDayId/exercises', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(WorkoutController)), ...(fetchMiddlewares(WorkoutController.prototype.createPlanDayExercise)), function WorkoutController_createPlanDayExercise(request, response, next) {
        const args = {
            planDayId: { "in": "path", "name": "planDayId", "required": true, "dataType": "double" },
            requestBody: { "in": "body", "name": "requestBody", "required": true, "ref": "CreatePlanDayExerciseRequest" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new WorkoutController();
            const promise = controller.createPlanDayExercise.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 201, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    app.put('/workouts/exercises/:id', authenticateMiddleware([{ "bearerAuth": [] }]), ...(fetchMiddlewares(WorkoutController)), ...(fetchMiddlewares(WorkoutController.prototype.updatePlanDayExercise)), function WorkoutController_updatePlanDayExercise(request, response, next) {
        const args = {
            id: { "in": "path", "name": "id", "required": true, "dataType": "double" },
            requestBody: { "in": "body", "name": "requestBody", "required": true, "ref": "Partial_InsertPlanDayExercise_" },
        };
        // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        let validatedArgs = [];
        try {
            validatedArgs = getValidatedArgs(args, request, response);
            const controller = new WorkoutController();
            const promise = controller.updatePlanDayExercise.apply(controller, validatedArgs);
            promiseHandler(controller, promise, response, 200, next);
        }
        catch (err) {
            return next(err);
        }
    });
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    function authenticateMiddleware(security = []) {
        return async function runAuthenticationMiddleware(request, _response, next) {
            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
            // keep track of failed auth attempts so we can hand back the most
            // recent one.  This behavior was previously existing so preserving it
            // here
            const failedAttempts = [];
            const pushAndRethrow = (error) => {
                failedAttempts.push(error);
                throw error;
            };
            const secMethodOrPromises = [];
            for (const secMethod of security) {
                if (Object.keys(secMethod).length > 1) {
                    const secMethodAndPromises = [];
                    for (const name in secMethod) {
                        secMethodAndPromises.push(expressAuthentication(request, name, secMethod[name])
                            .catch(pushAndRethrow));
                    }
                    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
                    secMethodOrPromises.push(Promise.all(secMethodAndPromises)
                        .then(users => { return users[0]; }));
                }
                else {
                    for (const name in secMethod) {
                        secMethodOrPromises.push(expressAuthentication(request, name, secMethod[name])
                            .catch(pushAndRethrow));
                    }
                }
            }
            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
            try {
                request['user'] = await promiseAny.call(Promise, secMethodOrPromises);
                next();
            }
            catch (err) {
                // Show most recent error as response
                const error = failedAttempts.pop();
                error.status = error.status || 401;
                next(error);
            }
            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
        };
    }
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    function isController(object) {
        return 'getHeaders' in object && 'getStatus' in object && 'setStatus' in object;
    }
    function promiseHandler(controllerObj, promise, response, successStatus, next) {
        return Promise.resolve(promise)
            .then((data) => {
            let statusCode = successStatus;
            let headers;
            if (isController(controllerObj)) {
                headers = controllerObj.getHeaders();
                statusCode = controllerObj.getStatus() || statusCode;
            }
            // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
            returnHandler(response, statusCode, data, headers);
        })
            .catch((error) => next(error));
    }
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    function returnHandler(response, statusCode, data, headers = {}) {
        if (response.headersSent) {
            return;
        }
        Object.keys(headers).forEach((name) => {
            response.set(name, headers[name]);
        });
        if (data && typeof data.pipe === 'function' && data.readable && typeof data._read === 'function') {
            response.status(statusCode || 200);
            data.pipe(response);
        }
        else if (data !== null && data !== undefined) {
            response.status(statusCode || 200).json(data);
        }
        else {
            response.status(statusCode || 204).end();
        }
    }
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    function responder(response) {
        return function (status, data, headers) {
            returnHandler(response, status, data, headers);
        };
    }
    ;
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
    function getValidatedArgs(args, request, response) {
        const fieldErrors = {};
        const values = Object.keys(args).map((key) => {
            const name = args[key].name;
            switch (args[key].in) {
                case 'request':
                    return request;
                case 'query':
                    return validationService.ValidateParam(args[key], request.query[name], name, fieldErrors, undefined, { "noImplicitAdditionalProperties": "throw-on-extras" });
                case 'queries':
                    return validationService.ValidateParam(args[key], request.query, name, fieldErrors, undefined, { "noImplicitAdditionalProperties": "throw-on-extras" });
                case 'path':
                    return validationService.ValidateParam(args[key], request.params[name], name, fieldErrors, undefined, { "noImplicitAdditionalProperties": "throw-on-extras" });
                case 'header':
                    return validationService.ValidateParam(args[key], request.header(name), name, fieldErrors, undefined, { "noImplicitAdditionalProperties": "throw-on-extras" });
                case 'body':
                    return validationService.ValidateParam(args[key], request.body, name, fieldErrors, undefined, { "noImplicitAdditionalProperties": "throw-on-extras" });
                case 'body-prop':
                    return validationService.ValidateParam(args[key], request.body[name], name, fieldErrors, 'body.', { "noImplicitAdditionalProperties": "throw-on-extras" });
                case 'formData':
                    if (args[key].dataType === 'file') {
                        return validationService.ValidateParam(args[key], request.file, name, fieldErrors, undefined, { "noImplicitAdditionalProperties": "throw-on-extras" });
                    }
                    else if (args[key].dataType === 'array' && args[key].array.dataType === 'file') {
                        return validationService.ValidateParam(args[key], request.files, name, fieldErrors, undefined, { "noImplicitAdditionalProperties": "throw-on-extras" });
                    }
                    else {
                        return validationService.ValidateParam(args[key], request.body[name], name, fieldErrors, undefined, { "noImplicitAdditionalProperties": "throw-on-extras" });
                    }
                case 'res':
                    return responder(response);
            }
        });
        if (Object.keys(fieldErrors).length > 0) {
            throw new ValidateError(fieldErrors, '');
        }
        return values;
    }
    // WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
}
// WARNING: This file was auto-generated with tsoa. Please do not modify it. Re-run tsoa to re-generate this file: https://github.com/lukeautry/tsoa
