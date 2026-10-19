import { describe, it, expect } from "@jest/globals";
import { assembleReport } from "@/services/usage-report.service";
import { isInternalAccount } from "@/constants/usage-report";
import {
  usageReportTemplate,
  usageReportSubject,
  weekLabel,
  deltaLabel,
} from "@/templates/usage-report-email";

// Mon Oct 12 – Sun Oct 18 2026, Central (CDT = UTC-5).
const weekStart = new Date("2026-10-12T05:00:00Z");
const weekEnd = new Date("2026-10-19T05:00:00Z");
const prevStart = new Date("2026-10-05T05:00:00Z");

const user = (id: number, created: string, extra: Partial<{ needs_onboarding: boolean }> = {}) => ({
  id,
  email: `user${id}@gmail.com`,
  name: `User ${id}`,
  created_at: new Date(created),
  needs_onboarding: extra.needs_onboarding ?? false,
  fitness_level: "beginner",
});

function build() {
  const users = [
    user(1, "2026-08-01T00:00:00Z"), // trained both weeks
    user(2, "2026-08-01T00:00:00Z"), // trained last week only → went quiet
    user(3, "2026-10-14T15:00:00Z"), // new, has plan, never trained
    user(4, "2026-10-15T15:00:00Z", { needs_onboarding: true }), // new, stuck in setup
    user(5, "2026-10-08T15:00:00Z"), // signed up the week before
  ];
  return assembleReport({
    weekStart,
    weekEnd,
    prevStart,
    timezone: "America/Chicago",
    users,
    byId: new Map(users.map((u) => [u.id, u])),
    sessions: [
      { user_id: 1, this_week: "3", last_week: "2", ever: "20" },
      { user_id: 2, this_week: "0", last_week: "1", ever: "4" },
    ],
    activities: [{ user_id: 1, this_week: "1", last_week: "0", ever: "1" }],
    planUserIds: new Set([1, 2, 3]),
    subs: [
      { user_id: 1, paying: true, renewing: false, comped: false },
      { user_id: 2, paying: false, renewing: false, comped: true },
      { user_id: 99, paying: true, renewing: true, comped: false }, // not a real user
    ],
    money: [
      { event_type: "INITIAL_PURCHASE", app_user_id: "1", price: "12.99", created_at: new Date("2026-10-13T12:00:00Z") },
      { event_type: "CANCELLATION", app_user_id: "1", price: "0", created_at: new Date("2026-10-17T12:00:00Z") },
      { event_type: "RENEWAL", app_user_id: "1", price: "12.99", created_at: new Date("2026-10-06T12:00:00Z") },
      { event_type: "INITIAL_PURCHASE", app_user_id: "99", price: "12.99", created_at: new Date("2026-10-13T12:00:00Z") },
      { event_type: "INITIAL_PURCHASE", app_user_id: "$RCAnonymousID:abc", price: "12.99", created_at: new Date("2026-10-13T12:00:00Z") },
    ],
  });
}

describe("assembleReport", () => {
  const report = build();

  it("counts active users, sessions and activities per window", () => {
    expect(report.thisWeek).toMatchObject({ active: 1, sessions: 3, activities: 1, signups: 2 });
    expect(report.lastWeek).toMatchObject({ active: 2, sessions: 3, activities: 0, signups: 1 });
    expect(report.activatedEver).toBe(2);
    expect(report.realUsers).toBe(5);
  });

  it("flags someone who trained last week but not this week", () => {
    expect(report.wentQuiet.map((u) => u.userId)).toEqual([2]);
  });

  it("places each newcomer at the furthest stage reached", () => {
    expect(report.newcomers.map((u) => [u.userId, u.stage])).toEqual([
      [3, "has-plan"],
      [4, "signed-up"],
    ]);
  });

  it("counts only real users' money, and revenue only from purchases and renewals", () => {
    expect(report.thisWeek.revenue).toBe(12.99);
    expect(report.lastWeek.revenue).toBe(12.99);
    expect(report.moneyEvents.map((m) => m.type)).toEqual(["INITIAL_PURCHASE", "CANCELLATION"]);
    expect(report.payingNow).toBe(1);
    expect(report.renewing).toBe(0);
    expect(report.comped).toBe(1);
  });

  it("renders a subject and email that carry the numbers", () => {
    expect(weekLabel(report)).toBe("Oct 12 – 18");
    expect(usageReportSubject(report)).toBe("[MastersFit] Weekly usage, Oct 12 – 18: 1 trained (−1)");
    const { html, text } = usageReportTemplate(report);
    expect(text).toContain("1 person trained last week.");
    expect(text).toContain("User 2");
    expect(html).toContain("Went quiet");
  });
});

describe("deltaLabel", () => {
  it("describes the change against the week before", () => {
    expect(deltaLabel(5, 3)).toBe("+2 vs week before");
    expect(deltaLabel(3, 5)).toBe("−2 vs week before");
    expect(deltaLabel(4, 4)).toBe("same as week before");
    expect(deltaLabel(25.98, 12.99, true)).toBe("+$12.99 vs week before");
  });
});

describe("isInternalAccount", () => {
  it("excludes our own domains, including disposable rtp+ test accounts", () => {
    expect(isInternalAccount("rtp@mastersfit.ai")).toBe(true);
    expect(isInternalAccount("rtp+42@mastersfit.ai")).toBe(true);
    expect(isInternalAccount("someone@conradlabs.com")).toBe(true);
    expect(isInternalAccount("test-1@example.test")).toBe(true);
  });

  it("keeps real customers", () => {
    expect(isInternalAccount("jane.doe@gmail.com")).toBe(false);
  });
});
