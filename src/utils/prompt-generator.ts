import { Profile } from "@/models";

export const buildClaudePrompt = (
  profile: Profile,
  exerciseNames: string[],
  customFeedback?: string
) => {
  const prompt = `
    You are an experienced fitness trainer. Based on the following user profile, generate a personalized fitness plan:

    - Age: ${profile.age}
    - Gender: ${profile.gender}
    - Height: ${profile.height} cm
    - Weight: ${profile.weight} kg

    **User Profile:**
    - Goals: ${profile.goals}
    - Physical Limitations: ${profile.limitations}
    - Fitness Level: ${profile.fitnessLevel}
    - Workout Environment: ${profile.environment}
    - Available Equipment: ${profile.equipment}
    - Preferred Exercise Styles: ${profile.preferredStyles}
    - Available Days per Week: ${
      profile.availableDays ? profile.availableDays.length : 7
    }
    - Preferred Workout Duration: ${
      profile.workoutDuration || 30
    } minutes per session
    - Desired Intensity Level: ${profile.intensityLevel}
    - Medical Notes: ${profile.medicalNotes}
    - Custom Feedback: ${customFeedback}

    **Instructions:**

    1. Design a workout plan for **exactly ${
      profile.availableDays ? profile.availableDays.length : 7
    } days**.
      - If user has fewer than 7 days available, only include that many days in 'workoutPlan'.
      - Number each day from 1 to ${
        profile.availableDays ? profile.availableDays.length : 7
      }.

    2. **IMPORTANT**: Each workout session should be designed to fit within approximately ${
      profile.workoutDuration || 30
    } minutes.
      - Consider rest times, exercise duration, and transitions between exercises.
      - Adjust the number of exercises, sets, and reps to fit this time constraint.
      - The duration you provide for each exercise must be in seconds.

    3. Be **strictly compliant** with the user's limitations, environment, equipment, fitness level, intensity level, and medical notes.
      - These constraints **MUST NOT** be violated.

    4. You may use exercises from the provided list: ${exerciseNames}
    - If this list is insufficient to meet the user's goals, **you MAY add new exercises**.
    - Any new exercise MUST be included in 'exercisesToAdd' (structure defined below).
    - New exercises MUST only use the user's available equipment.

    5. You must ONLY choose values for "equipment" in "exercisesToAdd" from the following: ["dumbbells", "resistance_bands", "machines", "bodyweight", "kettlebells", "medicine_ball", "foam_roller", "treadmill", "bike", "yoga_mat"]

    6. Workout plan name should be a very short name for the plan.

    7. Workout plan description should be a very short description for the plan. (10-15 words)

    8. EVERY exercise you add to the workout plan MUST be a valid exercise with actual movements that can be performed and not a general suggestion. 
    - For example, "Warmup" or "Stretching" are not valid exercises, but "Pushups" or "Squats" are valid exercises.

    9. Your entire response MUST be a **valid JSON object** with **exactly** the following structure and keys:

    10. If the user has provided custom feedback, you MUST incorporate it into the workout plan.

    {
    "name": "string (workout plan name)",
    "description": "string (summary of the plan)",
    "workoutPlan": [
    {
      "day": number,
      "exercises": [
        {
          "exerciseName": "string",
          "sets": number,
          "reps": number,
          "weight": number,
          "duration": number,
          "restTime": number,
          "notes": "string"
        }
      ]
    }
    ],
    "exercisesToAdd": [
    {
      "name": "string",
      "description": "string",
      "equipment": ["string"],
      "muscleGroups": ["string"],
      "difficulty": "low" | "moderate" | "high",
      "instructions": "string"
    }
    ]
    }

    Output MUST:
    - Be strictly valid JSON
    - Match the exact keys above (no extra keys, no summaries, no Markdown)
    - Include all required fields, even if values are empty strings or zero

    If you are unsure whether to add a new exercise or not, you SHOULD err on the side of including a well-reasoned addition, with all metadata defined as required above.
  `;

  return prompt;
};

export const buildClaudeDailyPrompt = (
  profile: Profile,
  exerciseNames: string[],
  dayNumber: number,
  previousWorkout: any,
  regenerationReason: string
) => {
  const prompt = `
    You are an experienced fitness trainer. Based on the following user profile, regenerate a single day's workout session by addressing the user's feedback.

    **User Profile:**
    - Age: ${profile.age}
    - Gender: ${profile.gender}
    - Height: ${profile.height} cm
    - Weight: ${profile.weight} kg
    - Goals: ${profile.goals}
    - Physical Limitations: ${profile.limitations}
    - Fitness Level: ${profile.fitnessLevel}
    - Workout Environment: ${profile.environment}
    - Available Equipment: ${profile.equipment}
    - Preferred Styles: ${profile.preferredStyles}
    - Preferred Workout Duration: ${profile.workoutDuration || 30} minutes
    - Desired Intensity Level: ${profile.intensityLevel}
    - Medical Notes: ${profile.medicalNotes}

    **Previously Generated Workout (Day ${dayNumber}):**
    ${JSON.stringify(previousWorkout, null, 2)}

    **User Feedback / Reason for Regeneration:**
    "${regenerationReason}"

    **Instructions:**

    1. Regenerate a single workout session that fits within approximately ${
      profile.workoutDuration || 30
    } minutes.
      - Consider rest, exercise time, transitions.
      - Adjust exercises, sets, or reps based on user feedback.
      - Be compliant with all physical and medical limitations.

    2. You may use exercises from this list: ${exerciseNames}
      - Add new ones only if necessary.
      - New exercises must use one or more of: ["dumbbells", "resistance_bands", "machines", "bodyweight", "kettlebells", "medicine_ball", "foam_roller", "treadmill", "bike", "yoga_mat"]
      - Include them in "exercisesToAdd" with all required metadata.

    **Return a JSON object in the following format:**

    {
      "day": ${dayNumber},
      "exercises": [
        {
          "exerciseName": "string",
          "sets": number,
          "reps": number,
          "weight": number,
          "duration": number,
          "restTime": number,
          "notes": "string"
        }
      ],
      "exercisesToAdd": [
        {
          "name": "string",
          "description": "string",
          "equipment": ["string"],
          "muscleGroups": ["string"],
          "difficulty": "low" | "moderate" | "high",
          "instructions": "string"
        }
      ]
    }

    - Ensure strict JSON compliance (no markdown, no explanations).
    - Always include all required fields, even if values are 0 or "".
    `;

  return prompt;
};
