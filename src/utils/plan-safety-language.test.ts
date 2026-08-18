import { describe, it, expect } from "@jest/globals";
import {
  detectSafetyClaims,
  sanitizeSafetyLanguage,
  sanitizeGeneratedContent,
} from "@/utils/plan-safety-language";

/**
 * Representative claim-laden plan text the LLM has been observed to (or plausibly
 * would) produce for each limitation profile. Each string carries prohibited
 * safety/medical/guarantee language; after sanitizing, NONE may remain.
 */
const PROFILE_SAMPLES: Record<string, string[]> = {
  "shoulder pain / history": [
    "3-day split — shoulder-safe programming built for training after 40.",
    "Shoulder-safe pressing and rows with a short finisher.",
    "A pain-free upper-body day that protects your shoulders.",
  ],
  "knee replacement / history": [
    "Knee-safe lower-body work selected to be safe for your replacement.",
    "Low-impact, joint-safe squats that prevent injury to the knee.",
  ],
  "arthritis / joint limitations": [
    "Joint-safe mobility flow, doctor-approved for arthritis.",
    "These movements are safe and will not aggravate your joints.",
  ],
  "back pain / history": [
    "Back-safe hinge patterns that treat lower-back pain.",
    "A spine-safe core circuit, guaranteed pain-free.",
  ],
  "recent procedure": [
    "Post-op safe programming that rehabilitates your recovery.",
    "Clinically-approved exercises to cure your condition safely.",
  ],
  "multiple simultaneous limitations": [
    "Shoulder-safe and knee-safe full-body plan, injury-proof and pain-free.",
    "Medically-approved, joint-safe training that prevents reinjury.",
  ],
};

describe("plan-safety-language", () => {
  describe("sanitize removes all prohibited claims for every profile", () => {
    for (const [profile, samples] of Object.entries(PROFILE_SAMPLES)) {
      for (const sample of samples) {
        it(`[${profile}] "${sample.slice(0, 48)}..."`, () => {
          const out = sanitizeSafetyLanguage(sample);
          expect(detectSafetyClaims(out)).toEqual([]);
          // sanity: it did not blank the text
          expect(out.length).toBeGreaterThan(0);
        });
      }
    }
  });

  it("neutralizes the exact demo-seed description", () => {
    const out = sanitizeSafetyLanguage(
      "3-day split balancing strength, conditioning, and mobility — shoulder-safe programming built for training after 40."
    );
    expect(out.toLowerCase()).not.toContain("shoulder-safe");
    expect(detectSafetyClaims(out)).toEqual([]);
  });

  it("leaves legitimate text untouched", () => {
    const clean = "Compound pressing, rows and squats to round out the week.";
    expect(sanitizeSafetyLanguage(clean)).toBe(clean);
    expect(detectSafetyClaims(clean)).toEqual([]);
  });

  it("does not false-positive on 'safety' inside other words or benign phrasing", () => {
    // "adapted around your reported shoulder history" is the sanctioned phrasing.
    const ok = "Adapted around your reported shoulder history and available equipment.";
    expect(detectSafetyClaims(ok)).toEqual([]);
    expect(sanitizeSafetyLanguage(ok)).toBe(ok);
  });

  describe("sanitizeGeneratedContent walks a full generated plan", () => {
    it("sanitizes name, description, day focus, block description, exercise notes, and conflicts — leaves ids/enums alone", () => {
      const plan = {
        name: "Shoulder-Safe Full-Body Strength",
        description: "Knee-safe programming that prevents injury.",
        feedbackConflicts: [
          { request: "heavy squats", reason: "kept the day joint-safe instead" },
        ],
        workoutPlan: [
          {
            day: 1,
            name: "Pain-free Upper Body",
            focus: "A shoulder-safe pressing focus that treats soreness.",
            blocks: [
              {
                blockType: "traditional", // enum — must NOT be touched
                description: "Injury-proof pressing block.",
                exercises: [
                  {
                    exerciseName: "Bench Press", // not a user-visible-claim key we scrub
                    notes: "Doctor-approved, safe for your shoulder.",
                    muscleGroups: ["chest"], // must NOT be touched
                  },
                ],
              },
            ],
          },
        ],
      };

      const { value, findings } = sanitizeGeneratedContent(plan);

      // every user-visible field is clean
      const visible = [
        value.name,
        value.description,
        value.feedbackConflicts[0].request,
        value.feedbackConflicts[0].reason,
        value.workoutPlan[0].name,
        value.workoutPlan[0].focus,
        value.workoutPlan[0].blocks[0].description,
        value.workoutPlan[0].blocks[0].exercises[0].notes,
      ];
      for (const s of visible) expect(detectSafetyClaims(s)).toEqual([]);

      // untouched structural fields
      expect(value.workoutPlan[0].blocks[0].blockType).toBe("traditional");
      expect(value.workoutPlan[0].blocks[0].exercises[0].exerciseName).toBe("Bench Press");
      expect(value.workoutPlan[0].blocks[0].exercises[0].muscleGroups).toEqual(["chest"]);

      // findings recorded for telemetry
      expect(findings.length).toBeGreaterThanOrEqual(6);
      expect(findings.every((f) => f.claims.length > 0)).toBe(true);
    });

    it("is a no-op on an already-clean plan (no findings)", () => {
      const clean = {
        name: "Full-Body Strength",
        description: "Adapted around your reported shoulder history.",
        workoutPlan: [
          { day: 1, name: "Upper Body", focus: "Horizontal pressing and rows.", blocks: [] },
        ],
      };
      const { findings } = sanitizeGeneratedContent(clean);
      expect(findings).toEqual([]);
    });
  });
});
