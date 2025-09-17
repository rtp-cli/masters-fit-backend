import { ChatAnthropic } from "@langchain/anthropic";
import { ChatMessageHistory } from "langchain/stores/message/in_memory";
import { SystemMessage, HumanMessage, AIMessage } from "@langchain/core/messages";
import { Profile } from "@/models";
import { logger } from "@/utils/logger";
import { exerciseService, ExerciseMetadata } from "./exercise.service";

// Import helper functions from prompt-generator
const getEquipmentDescription = (
  environment?: string | null,
  equipment?: any,
  otherEquipment?: string | null
): string => {
  if (!environment) return "Equipment not specified";

  switch (environment) {
    case "commercial_gym":
      return "COMMERCIAL GYM - Full access to comprehensive gym equipment including: barbells, benches (flat/incline/decline), pull-up bars, exercise bikes, medicine balls, plyo boxes, rings, resistance bands, stability balls, dumbbells of all weights, kettlebells, squat racks, dip bars, rowing machines, slam balls, cable machines, jump ropes, foam rollers, and all other standard commercial gym equipment.";
    case "bodyweight_only":
      return "BODYWEIGHT ONLY - No equipment available except body weight. User has chosen to workout using only their body weight with no additional equipment whatsoever. Do not include any equipment-based exercises.";
    case "home_gym":
      const selectedEquipment = Array.isArray(equipment) ? equipment : [];
      const equipmentList =
        selectedEquipment.length > 0
          ? selectedEquipment.join(", ")
          : "None specified";
      const otherEquipmentText = otherEquipment
        ? ` Additional custom equipment: ${otherEquipment}`
        : "";
      return `HOME GYM - User has access to the following equipment: ${equipmentList}.${otherEquipmentText}`;
    default:
      const defaultEquipment = Array.isArray(equipment)
        ? equipment.join(", ")
        : equipment || "None specified";
      const defaultOtherEquipment = otherEquipment
        ? ` Additional: ${otherEquipment}`
        : "";
      return `Equipment: ${defaultEquipment}${defaultOtherEquipment}`;
  }
};

const getStyleInterpretationGuide = (): string => {
  return `
## STYLE PROGRAMMING GUIDELINES

Each workout style requires distinct programming philosophy, structure, and coaching approach:

### CrossFit Programming
- **Formats:** AMRAP, EMOM, For Time, Chipper
- **Structure:** Warm-up → WOD → Cool-down
- **Characteristics:** High intensity, functional movements, scoreable workouts
- **Language:** Use authentic CrossFit terminology (Rx, scaled, pacing cues)
- **Block Types:** Use "amrap", "emom", or "for_time" - never "traditional"

### HIIT Programming
- **Formats:** Tabata, Circuit intervals, Work/Rest ratios (30s on/15s off, 40:20, etc.)
- **Structure:** Dynamic warm-up → High-intensity intervals → Recovery
- **Characteristics:** Time-based intervals, minimal rest, heart rate elevation
- **Block Types:** Use "circuit" or "tabata" with high-intensity exercises

### Strength Programming
- **Formats:** Traditional sets/reps (5x5, 4x8), Pyramid sets, Progressive overload
- **Structure:** Warm-up → Main lifts → Accessory work → Cool-down
- **Characteristics:** Compound movements, rest periods, form focus
- **Block Types:** Use "traditional" with proper sets/reps/rest

### Other Styles
- **Yoga:** Flow sequences, breath coordination, mindful transitions
- **Pilates:** Core stability, controlled movement, spinal alignment
- **Functional:** Multi-planar movements, real-life patterns, compound movements
`;
};

const getConstraintIntegrationProtocol = (): string => {
  return `
## UNIVERSAL LIMITATION HANDLING RULE

You must ALWAYS adapt exercises based on any physical limitations, pain points, or recovery needs mentioned in the profile, without requiring them to be explicitly defined in detail.

Your job is to:
- Identify which joints, movements, or ranges are affected by the user's limitation
- Automatically remove or modify any exercise that would aggravate that limitation
- Substitute with a safe, effective alternative that still matches the style and workout objective
- Ensure the workout remains authentic to the chosen style while respecting all limitations

**Examples:**
- "Knee pain" → avoid deep squats, lunges, jumping; prefer supported or partial ROM options
- "Shoulder pain" → avoid overhead pressing or dips; prefer scapular stability work
- "Lower back pain" → avoid loaded spinal flexion; prefer core stability and hip-dominant moves

Always apply this logic to every block and every exercise without needing specific instructions.
`;
};

const getBlockTypeGuide = (): string => {
  return `
## BLOCK TYPE PROGRAMMING GUIDE

- **"traditional"**: Standard sets x reps format. Use actual sets (3-5), reps (5-15), and rest periods (30-120s).
- **"amrap"**: As Many Rounds As Possible. Set timeCapMinutes (15-25), use sets=1 for all exercises, specify target reps per round.
- **"emom"**: Every Minute On the Minute. Set timeCapMinutes (8-20), use sets=1, specify work per minute.
- **"for_time"**: Complete prescribed work as fast as possible. Set rounds (3-5), use sets=1, specify reps per round.
- **"circuit"**: Timed circuit training. Set rounds (3-6), use sets=1, specify work duration or reps, short restTime (15-30s).
- **"flow"**: Continuous movement sequence (yoga, pilates). Set rounds (3-8), use sets=1, specify hold duration.
- **"tabata"**: 20s work, 10s rest format. Set rounds (4-8), use sets=1, duration=20, restTime=10.
- **"warmup"**: Simple dynamic warm-up movements. Set rounds (1), use sets=1, specify movement duration (10-15s).
- **"cooldown"**: Static stretches and recovery movements. Set rounds (1), use sets=1, specify hold duration (20-30s).
`;
};

const getDurationRequirements = (
  workoutDuration: number,
  context: "weekly" | "daily" = "weekly",
  includeWarmup: boolean = true,
  includeCooldown: boolean = true
): string => {
  const sessionReference =
    context === "weekly" ? "Each workout session" : "This workout session";

  return `
## DURATION REQUIREMENTS - MANDATORY COMPLIANCE

**CRITICAL DURATION REQUIREMENT**
${sessionReference} MUST be EXACTLY ${workoutDuration} minutes (acceptable range: ${workoutDuration - 5} to ${workoutDuration + 5} minutes).

**MANDATORY BLOCK DURATION CALCULATION:**
For each block you create, you MUST calculate and specify the exact duration in minutes:
- Calculate total block time using the appropriate formulas
- Include this as "blockDurationMinutes" field in each block
- Sum all blockDurationMinutes = total session time
- Verify total equals ${workoutDuration} ±5 minutes before submitting

**MANDATORY MINIMUM BLOCK REQUIREMENTS:**
- **User Warmup Preference:** ${includeWarmup ? "MUST include warm-up block (2-3 minutes)" : "User has disabled warmups - DO NOT include warmup blocks"}
- **User Cooldown Preference:** ${includeCooldown ? "MUST include cool-down block (2-3 minutes)" : "User has disabled cooldowns - DO NOT include cooldown blocks"}
- **Under 45 minutes:** Minimum ${includeWarmup && includeCooldown ? "4" : includeWarmup || includeCooldown ? "3" : "2"} blocks
- **45+ minutes:** MINIMUM ${includeWarmup && includeCooldown ? "5" : includeWarmup || includeCooldown ? "4" : "3"} blocks
- **70+ minutes:** MINIMUM ${includeWarmup && includeCooldown ? "6" : includeWarmup || includeCooldown ? "5" : "4"} blocks
`;
};

const getJsonOutputFormat = (profile: Profile): string => {
  return `
## OUTPUT FORMAT - CRITICAL JSON REQUIREMENTS

Your response MUST be a **valid JSON object** with **exactly** the following structure and keys:

**PRIORITY HIERARCHY - DURATION FIRST:**
1. **DURATION COMPLIANCE IS THE HIGHEST PRIORITY** - Meeting ${profile.workoutDuration || 30} minutes is MORE IMPORTANT than token efficiency
2. **Add as many blocks and exercises as needed** to reach target duration
3. **Response should be under 10,000 tokens when possible, BUT duration compliance comes first**

\`\`\`json
{
  "day": number,
  "name": "string (name of this workout day, e.g., 'Upper Body Strength + AMRAP')",
  "description": "string (brief description of this day's focus)",
  "instructions": "string (comprehensive day-level coaching instructions that explain the overall workout flow, pacing, intensity, and how to execute this specific workout structure)",
  "blocks": [
    {
      "blockType": "traditional" | "amrap" | "emom" | "for_time" | "circuit" | "flow" | "tabata" | "warmup" | "cooldown",
      "blockName": "string (name of this workout block, e.g., 'AMRAP WOD', 'Strength Circuit', 'Sun Salutation Flow')",
      "blockDurationMinutes": number (REQUIRED: calculated total duration of this block in minutes),
      "timeCapMinutes": number (total time for this block type, only relevant for time-based formats like AMRAP, EMOM),
      "rounds": number (number of rounds for circuit/flow types, use 1 for traditional sets),
      "instructions": "string (block-specific coaching instructions that explain this block's format, pacing, and execution)",
      "order": number (order of this block within the day, starting from 1),
      "exercises": [
        {
          "exerciseName": "string",
          "sets": number (for traditional blocks, actual sets; for AMRAP/circuits, use 1; for flows, use rounds),
          "reps": number (target reps per set/round, 0 for time-based exercises),
          "weight": number,
          "duration": number (seconds per set/hold, 0 for rep-based exercises),
          "restTime": number (seconds rest between sets; for circuits/AMRAP, rest between exercises within a round),
          "notes": "string (exercise-specific coaching cues)",
          "order": number (order of this exercise within the block, starting from 1)
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
      "instructions": "string" (exercise specific instructions, not workout instructions),
      "link": "string",
      "tag": "string"
    }
  ]
}
\`\`\`

**OUTPUT REQUIREMENTS:**
- **VALID JSON ONLY**: Your entire response must be parseable JSON - no markdown, no explanations outside the JSON structure
- **COMPLETE RESPONSE**: Generate the complete day's workout as requested
- **PROPER BLOCK DISTRIBUTION**: Create as many blocks as needed with reasonable exercise density (3-6 exercises per main block)
`;
};

const getCriticalConstraints = (
  context: "weekly" | "daily" = "weekly"
): string => {
  const scopeReference =
    context === "weekly" ? "Generate full week" : "Generate complete workout";

  return `
## CRITICAL CONSTRAINTS

1. **DURATION COMPLIANCE FIRST**: Every workout must meet target duration ±5 minutes - ignore token limits
2. **Include blockDurationMinutes**: Calculate and include duration for each block
3. **Valid JSON format only** - no markdown or explanations
4. **${scopeReference}** as requested
5. **MANDATORY MINIMUM BLOCKS**:
   - 30+ min = minimum 3 blocks (warmup + main + cooldown)
   - 45+ min = minimum 4 blocks (warmup + 2 main + cooldown)
   - 60+ min = minimum 5 blocks (warmup + 3 main + cooldown)
6. **BLOCK BALANCE REQUIRED**: Main workout blocks should contain 3-6 exercises (warmup: 2-3, cooldown: 2-3)
7. **Respect user limitations** and available equipment
`;
};

export class WorkoutAgentService {
  private llm: ChatAnthropic;
  private messageHistories: Map<string, ChatMessageHistory> = new Map();

  constructor() {
    this.llm = new ChatAnthropic({
      modelName: "claude-3-sonnet-20240229",
      anthropicApiKey: process.env.ANTHROPIC_API_KEY,
      maxTokens: 8192,
      temperature: 0.1,
    });
  }


  private async callExerciseSearchTool(filters: any): Promise<ExerciseMetadata[]> {
    try {
      const exercises = await exerciseService.searchExercises(filters);

      logger.info("Exercise search tool called", {
        operation: "searchExercises",
        metadata: {
          filters,
          resultCount: exercises.length,
        }
      });

      return exercises;
    } catch (error) {
      logger.error("Exercise search tool failed", error as Error, {
        operation: "searchExercises",
        metadata: { filters }
      });
      throw error;
    }
  }

  private async processWithTools(
    userMessage: HumanMessage,
    systemMessage: SystemMessage,
    existingMessages: any[],
    userId: number,
    threadId: string
  ): Promise<any> {
    // Enhanced system message that explains tool calling
    const enhancedSystemContent = `${systemMessage.content}

## TOOL USAGE INSTRUCTIONS

You have access to an exercise search capability. When you need to find exercises for your workout design:

1. **Think about what exercises you need**: Consider muscle groups, equipment, difficulty, and style
2. **Request exercises**: In your response, include a special section like this:

EXERCISE_SEARCH_REQUEST:
{
  "muscleGroups": ["chest", "triceps"],
  "equipment": ["dumbbells"],
  "difficulty": ["moderate"],
  "limit": 30
}

3. **I will provide the results** and you can then complete your workout design
4. **Use the returned exercises** to create your final JSON workout plan

Remember: You don't call the tool directly. Just include EXERCISE_SEARCH_REQUEST sections in your response when you need exercises.`;

    const enhancedSystemMessage = new SystemMessage(enhancedSystemContent);

    // Combine all messages for the LLM call
    const messages = [
      enhancedSystemMessage,
      ...existingMessages,
      userMessage
    ];

    // First LLM call to get initial response
    const initialResponse = await this.llm.invoke(messages);
    let responseContent = initialResponse.content as string;

    // Check if the response contains exercise search requests
    const searchRequestPattern = /EXERCISE_SEARCH_REQUEST:\s*({[\s\S]*?})/g;
    let match;
    const searchRequests = [];

    while ((match = searchRequestPattern.exec(responseContent)) !== null) {
      try {
        const searchRequest = JSON.parse(match[1]);
        searchRequests.push(searchRequest);
      } catch (e) {
        logger.warn("Failed to parse exercise search request", {
          operation: "processWithTools",
          match: match[1]
        });
      }
    }

    // If there are search requests, execute them and provide results
    if (searchRequests.length > 0) {
      let exerciseResults = "";

      for (const request of searchRequests) {
        const exercises = await this.callExerciseSearchTool(request);
        exerciseResults += `\nEXERCISE_SEARCH_RESULTS for ${JSON.stringify(request)}:\n${JSON.stringify(exercises, null, 2)}\n`;
      }

      // Second LLM call with exercise results
      const toolResultMessage = new HumanMessage(`Here are the exercise search results:${exerciseResults}\n\nNow please complete the workout design using these exercises and respond with the final JSON workout plan.`);

      const finalMessages = [
        enhancedSystemMessage,
        ...existingMessages,
        userMessage,
        initialResponse,
        toolResultMessage
      ];

      const finalResponse = await this.llm.invoke(finalMessages);
      return finalResponse;
    }

    // No tools needed, return initial response
    return initialResponse;
  }

  private buildSystemMessage(
    profile: Profile,
    context: "weekly" | "daily" = "daily"
  ): SystemMessage {
    const workoutDuration = profile.workoutDuration || 30;
    const includeWarmup = profile.includeWarmup ?? true;
    const includeCooldown = profile.includeCooldown ?? true;

    // Combine all your prompt guidelines into a comprehensive system message
    const systemContent = `
# PROFESSIONAL FITNESS PROGRAMMING ASSISTANT

You are an experienced fitness trainer and certified fitness professional. Your role is to design complete, professional-quality workout programs that are authentic to the user's preferred training styles while respecting their limitations and constraints.

## YOUR CORE CAPABILITIES

${getStyleInterpretationGuide()}

${getConstraintIntegrationProtocol()}

${getBlockTypeGuide()}

${getDurationRequirements(workoutDuration, context, includeWarmup, includeCooldown)}

## EXERCISE SELECTION PROCESS

You have access to a **searchExercises** tool to find appropriate exercises. Follow this process:

**STEP 1: DESIGN WORKOUT STRUCTURE**
- Plan the complete workout structure based on the user's profile, goals, and requirements
- Determine what muscle groups, equipment, and difficulty levels you need for each block
- Focus on creating effective, balanced workouts that achieve the target duration of ${workoutDuration} minutes

**STEP 2: SEARCH FOR EXERCISES**
- For each workout block, use the searchExercises tool to find appropriate exercises
- Use specific filters based on your design needs:
  - muscleGroups: Target specific muscle groups (e.g., ["chest", "triceps"])
  - equipment: Filter by available equipment (merge profile + any regeneration overrides)
  - difficulty: Match user's fitness level and workout intensity
  - styles: Filter by workout style tags (e.g., ["crossfit", "strength", "hiit"])
  - limit: Control how many exercises you get back (default 50)

**STEP 3: SMART EXERCISE SELECTION**
- From the search results, select exercises that best fit your workout design
- Prioritize exercises that match the user's available equipment
- Consider variety, progression, and workout flow
- If you can't find suitable exercises, create new ones and add to 'exercisesToAdd'

**STEP 4: HANDLE REGENERATION OVERRIDES**
- If the regeneration reason mentions specific equipment (e.g., "add dumbbells"), include that in your search filters
- If user wants different styles temporarily, search with those style tags
- Profile settings are the baseline, regeneration reason takes priority for overrides

**TOOL USAGE EXAMPLES:**
- searchExercises({"muscleGroups": ["chest", "triceps"], "equipment": ["dumbbells"], "difficulty": ["moderate"]})
- searchExercises({"styles": ["hiit"], "muscleGroups": ["legs"], "limit": 20})
- searchExercises({"equipment": [], "difficulty": ["low"]}) // bodyweight only

## PROFESSIONAL PROGRAMMING PRIORITIES

Prioritize coaching quality over token efficiency:

- **STYLE-APPROPRIATE PROGRAMMING**: Match set/rep/rest schemes to chosen training style
- **SMART BLOCK STRUCTURE**: Adjust the number of blocks based on workout duration, intensity, and style
- **BLOCK PROGRESSION**: Structure blocks to flow logically (warm-up → main work → conditioning/cool-down)
- **VARIED BLOCK TYPES**: Use different block types within the same day to create comprehensive sessions
- **DAY-LEVEL INSTRUCTIONS**: Provide comprehensive coaching instructions including workout structure, intensity guidance, form emphasis, timing/tempo, mindset coaching, safety notes, and breathing patterns
- **EXERCISE-LEVEL NOTES**: Include specific coaching cues in individual exercise notes field
- **WEIGHT TARGETING:** Assign specific weights when exercises require resistance equipment
- **LOGICAL PROGRESSION**: Structure exercises in coaching-appropriate order with proper flow
- **PROFESSIONAL QUALITY**: Better to have fewer, well-programmed exercises than many poorly structured ones
- **DURATION BALANCE**: Use style-appropriate methods to reach target duration while maintaining workout integrity

${getJsonOutputFormat(profile)}

${getCriticalConstraints(context)}

## CONVERSATION MEMORY INSTRUCTIONS

You have access to our conversation history. Use it to:
1. Learn from previous feedback and regeneration reasons
2. Avoid repeating exercises the user didn't like
3. Build on successful patterns from previous workouts
4. Remember specific preferences mentioned in earlier messages
5. Progressively refine workouts based on the conversation thread

## OUTPUT REQUIREMENTS

ALWAYS respond with a valid JSON workout plan following the exact structure specified above.
No explanations or text outside the JSON structure.
`;

    return new SystemMessage(systemContent);
  }

  private buildUserMessage(
    profile: Profile,
    regenerationReason?: string,
    dayNumber?: number,
    isRestDay: boolean = false
  ): HumanMessage {
    // Much simpler user message - just the essentials
    const userContent = `
Generate a ${profile.workoutDuration}-minute workout for:

USER PROFILE:
- Age: ${profile.age}, Gender: ${profile.gender}
- Height: ${profile.height}cm, Weight: ${profile.weight}lbs
- Goals: ${profile.goals?.join(", ")}
- Limitations: ${profile.limitations?.join(", ") || "None"}
- Fitness Level: ${profile.fitnessLevel}
- Preferred Styles: ${profile.preferredStyles?.join(", ")}
- Environment: ${profile.environment}
- Equipment: ${getEquipmentDescription(profile.environment, profile.equipment, profile.otherEquipment)}

${dayNumber ? `Day Number: ${dayNumber}` : ""}
${isRestDay ? "This is a REST DAY workout." : ""}

${regenerationReason ? `
REGENERATION REASON (HIGHEST PRIORITY):
"${regenerationReason}"

The user is regenerating because of this specific feedback. Address it directly in the workout.
` : ""}

Generate the workout now.`;

    return new HumanMessage(userContent);
  }

  async regenerateWorkout(
    userId: number,
    profile: Profile,
    exerciseNames: string[], // This parameter is now unused but kept for compatibility
    threadId: string,
    regenerationReason: string,
    dayNumber?: number,
    isRestDay: boolean = false
  ): Promise<any> {
    try {
      // Get or create message history for this thread
      if (!this.messageHistories.has(threadId)) {
        this.messageHistories.set(threadId, new ChatMessageHistory());
      }

      const messageHistory = this.messageHistories.get(threadId)!;

      // Build messages (no longer need exerciseNames)
      const systemMessage = this.buildSystemMessage(profile, dayNumber ? "daily" : "weekly");
      const userMessage = this.buildUserMessage(profile, regenerationReason, dayNumber, isRestDay);

      // Get existing messages from history
      const existingMessages = await messageHistory.getMessages();

      logger.info("Calling LLM with tool support for workout generation", {
        userId,
        threadId,
        messageCount: existingMessages.length,
        operation: "regenerateWorkout"
      });

      // Process with tools
      const response = await this.processWithTools(
        userMessage,
        systemMessage,
        existingMessages,
        userId,
        threadId
      );

      // Add the exchange to history
      await messageHistory.addMessage(userMessage);
      await messageHistory.addMessage(response);

      // Parse and return the workout
      const cleanedResponse = this.cleanJsonResponse(response.content as string);
      return JSON.parse(cleanedResponse);

    } catch (error) {
      logger.error("Workout agent generation failed", error as Error, {
        userId,
        threadId,
        operation: "regenerateWorkout"
      });
      throw error;
    }
  }

  private cleanJsonResponse(response: string): string {
    const jsonBlockPattern = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/;
    const match = response.trim().match(jsonBlockPattern);
    return match ? match[1].trim() : response.trim();
  }

  clearThread(threadId: string) {
    this.messageHistories.delete(threadId);
    logger.info("Cleared conversation thread", { threadId });
  }

  // Get thread message count for debugging
  async getThreadMessageCount(threadId: string): Promise<number> {
    const history = this.messageHistories.get(threadId);
    if (history) {
      const messages = await history.getMessages();
      return messages.length;
    }
    return 0;
  }
}