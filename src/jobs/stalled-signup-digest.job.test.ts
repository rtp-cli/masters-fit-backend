import {
  describe,
  it,
  expect,
  jest,
  beforeEach,
  afterEach,
} from "@jest/globals";

jest.mock("@/services/email.service", () => ({
  emailService: {
    sendNewUserNotificationEmail: jest.fn(async () => undefined),
    sendStalledSignupDigestEmail: jest.fn(async () => undefined),
  },
}));

import { emailService } from "@/services/email.service";
import {
  signupNotificationService,
  type StalledSignup,
  type StalledSignIn,
  type StalledSignupReport,
} from "@/services/signup-notification.service";
import { runStalledSignupDigest } from "@/jobs/stalled-signup-digest.job";

const sendDigest = emailService.sendStalledSignupDigestEmail as jest.MockedFunction<
  typeof emailService.sendStalledSignupDigestEmail
>;

const NOW = new Date("2026-09-07T15:00:00Z");

function person(overrides: Partial<StalledSignup> = {}): StalledSignup {
  return {
    userId: 1,
    name: "Marcus Webb",
    email: "marcus.webb@example.com",
    createdAt: new Date("2026-09-01T14:00:00Z"),
    stalledDays: 6,
    hasSignedIn: true,
    lastSignInAt: new Date("2026-09-01T14:05:00Z"),
    isNewToDigest: true,
    ...overrides,
  };
}

/** Someone with no account — mailed a code, never came back. */
function signIn(overrides: Partial<StalledSignIn> = {}): StalledSignIn {
  return {
    email: "tom.reilly@example.com",
    firstCodeSentAt: new Date("2026-09-02T10:00:00Z"),
    lastCodeSentAt: new Date("2026-09-02T10:00:00Z"),
    codesSent: 1,
    failedAttempts: 0,
    stalledDays: 5,
    isNewToDigest: true,
    ...overrides,
  };
}

function report(
  stalled: StalledSignup[],
  stalledSignIns: StalledSignIn[] = []
): StalledSignupReport {
  const newlyStalled = stalled.filter((p) => p.isNewToDigest);
  const newlyStalledSignIns = stalledSignIns.filter((p) => p.isNewToDigest);
  return {
    stalled,
    newlyStalled,
    stalledSignIns,
    newlyStalledSignIns,
    hasAnythingNew: newlyStalled.length > 0 || newlyStalledSignIns.length > 0,
    signupsLast7Days: 11,
    finishedLast7Days: 8,
  };
}

describe("runStalledSignupDigest", () => {
  let getReport: jest.SpiedFunction<
    typeof signupNotificationService.getStalledSignupReport
  >;
  let mark: jest.SpiedFunction<
    typeof signupNotificationService.markStalledDigestNotified
  >;
  let markSignIns: jest.SpiedFunction<
    typeof signupNotificationService.markStalledSignInsReported
  >;
  let sweep: jest.SpiedFunction<
    typeof signupNotificationService.getUnnotifiedCompletedSignups
  >;
  let dispatch: jest.SpiedFunction<
    typeof signupNotificationService.dispatchNewUserAlert
  >;

  beforeEach(() => {
    jest.clearAllMocks();
    // clearAllMocks wipes call history but NOT implementations, so a
    // mockRejectedValue from an earlier test would leak into this one.
    sendDigest.mockReset();
    sendDigest.mockResolvedValue(undefined);
    process.env.SIGNUP_NOTIFY_ENABLED = "true";
    getReport = jest
      .spyOn(signupNotificationService, "getStalledSignupReport")
      .mockResolvedValue(report([person()]));
    mark = jest
      .spyOn(signupNotificationService, "markStalledDigestNotified")
      .mockResolvedValue(undefined);
    markSignIns = jest
      .spyOn(signupNotificationService, "markStalledSignInsReported")
      .mockResolvedValue(undefined);
    sweep = jest
      .spyOn(signupNotificationService, "getUnnotifiedCompletedSignups")
      .mockResolvedValue([]);
    dispatch = jest
      .spyOn(signupNotificationService, "dispatchNewUserAlert")
      .mockResolvedValue("sent");
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SIGNUP_NOTIFY_ENABLED;
  });

  describe("the send gate", () => {
    it("sends when somebody is new to the list", async () => {
      const result = await runStalledSignupDigest(NOW);

      expect(result.sent).toBe(true);
      expect(sendDigest).toHaveBeenCalledTimes(1);
    });

    it("sends NOTHING when nobody is stalled", async () => {
      getReport.mockResolvedValue(report([]));

      const result = await runStalledSignupDigest(NOW);

      expect(result).toMatchObject({ sent: false, reason: "nothing-new" });
      expect(sendDigest).not.toHaveBeenCalled();
    });

    it("sends NOTHING when everyone stalled has already been reported", async () => {
      // The whole reason a daily cadence is tolerable: yesterday's names do not
      // generate a second email today.
      getReport.mockResolvedValue(
        report([
          person({ userId: 1, isNewToDigest: false }),
          person({ userId: 2, isNewToDigest: false }),
        ])
      );

      const result = await runStalledSignupDigest(NOW);

      expect(result).toMatchObject({ sent: false, reason: "nothing-new", stalled: 2 });
      expect(sendDigest).not.toHaveBeenCalled();
      expect(mark).not.toHaveBeenCalled();
    });

    it("does nothing at all when the kill switch is off", async () => {
      delete process.env.SIGNUP_NOTIFY_ENABLED;

      const result = await runStalledSignupDigest(NOW);

      expect(result).toMatchObject({ sent: false, reason: "disabled" });
      expect(getReport).not.toHaveBeenCalled();
      expect(sendDigest).not.toHaveBeenCalled();
    });
  });

  describe("what the email carries", () => {
    it("shows the full worklist, not just the new arrivals", async () => {
      getReport.mockResolvedValue(
        report([
          person({ userId: 1, isNewToDigest: true }),
          person({ userId: 2, isNewToDigest: false }),
          person({ userId: 3, isNewToDigest: false }),
        ])
      );

      await runStalledSignupDigest(NOW);

      expect(sendDigest.mock.calls[0]?.[0]).toMatchObject({
        newCount: 1,
        totalCount: 3,
      });
    });

    it("draws the two groups from their two different sources", async () => {
      // Group A can only come from auth_codes — those people have no user row.
      // Group B can only come from users. A single query cannot produce both.
      getReport.mockResolvedValue(
        report(
          [person({ userId: 2, name: "Marcus" })],
          [signIn({ email: "tom.reilly@example.com" })]
        )
      );

      await runStalledSignupDigest(NOW);

      const params = sendDigest.mock.calls[0]?.[0]!;
      expect(params.neverSignedIn.map((p) => p.email)).toEqual([
        "tom.reilly@example.com",
      ]);
      expect(params.signedInNoProfile.map((p) => p.name)).toEqual(["Marcus"]);
    });

    it("puts an account with NO session in group A, keeping its name", async () => {
      // The legacy pre-verify /signup path an old client can still hit creates a
      // user row before any code is verified. Those people never got in, so
      // "Got in, didn't finish setup" would be a lie about them.
      getReport.mockResolvedValue(
        report([
          person({ userId: 1, name: "Legacy Larry", hasSignedIn: false, lastSignInAt: null }),
          person({ userId: 2, name: "Marcus", hasSignedIn: true }),
        ])
      );

      await runStalledSignupDigest(NOW);

      const params = sendDigest.mock.calls[0]?.[0]!;
      expect(params.neverSignedIn.map((p) => p.name)).toEqual(["Legacy Larry"]);
      expect(params.neverSignedIn[0]?.metaLine).toContain(
        "account created, never signed in"
      );
      expect(params.signedInNoProfile.map((p) => p.name)).toEqual(["Marcus"]);
    });

    it("carries NO name for the never-finished-sign-in group", async () => {
      // A name is only collected on the screen after a code is verified, so
      // there is genuinely nothing to show but the address.
      getReport.mockResolvedValue(report([], [signIn()]));

      await runStalledSignupDigest(NOW);

      expect(sendDigest.mock.calls[0]?.[0].neverSignedIn[0]?.name).toBeUndefined();
    });

    it("says whether a code was ever actually typed in", async () => {
      getReport.mockResolvedValue(
        report(
          [],
          [
            signIn({ email: "ignored@example.com", failedAttempts: 0 }),
            signIn({ email: "fumbled@example.com", failedAttempts: 3 }),
          ]
        )
      );

      await runStalledSignupDigest(NOW);

      const rows = sendDigest.mock.calls[0]?.[0].neverSignedIn!;
      expect(rows[0]?.metaLine).toContain("never entered a code");
      expect(rows[1]?.metaLine).toContain("entered a wrong code 3 times");
    });

    it("flags an address that was mailed several codes", async () => {
      getReport.mockResolvedValue(
        report([], [signIn({ codesSent: 3, lastCodeSentAt: new Date("2026-09-05T10:00:00Z") })])
      );

      await runStalledSignupDigest(NOW);

      expect(sendDigest.mock.calls[0]?.[0].neverSignedIn[0]?.metaLine).toContain(
        "3 codes, last Sep 5"
      );
    });

    it("distinguishes someone who came back from someone who never returned", async () => {
      getReport.mockResolvedValue(
        report([
          person({
            userId: 1,
            createdAt: new Date("2026-09-01T14:00:00Z"),
            lastSignInAt: new Date("2026-09-01T14:05:00Z"),
          }),
          person({
            userId: 2,
            createdAt: new Date("2026-09-04T14:00:00Z"),
            lastSignInAt: new Date("2026-09-05T09:00:00Z"),
          }),
        ])
      );

      await runStalledSignupDigest(NOW);

      const rows = sendDigest.mock.calls[0]?.[0].signedInNoProfile!;
      expect(rows[0]?.metaLine).toContain("hasn't been back");
      expect(rows[1]?.metaLine).toContain("came back since");
    });

    it("pluralizes the stall label", async () => {
      getReport.mockResolvedValue(
        report([person({ userId: 1, stalledDays: 1 }), person({ userId: 2, stalledDays: 6 })])
      );

      await runStalledSignupDigest(NOW);

      const rows = sendDigest.mock.calls[0]?.[0].signedInNoProfile!;
      expect(rows[0]?.stalledLabel).toBe("Stalled 1 day");
      expect(rows[1]?.stalledLabel).toBe("Stalled 6 days");
    });

    it("passes the context counters through", async () => {
      await runStalledSignupDigest(NOW);
      expect(sendDigest.mock.calls[0]?.[0]).toMatchObject({
        signupsLast7Days: 11,
        finishedLast7Days: 8,
      });
    });
  });

  describe("the missed-alert sweep", () => {
    it("re-dispatches alerts for completed users whose send was lost", async () => {
      sweep.mockResolvedValue([31, 32]);

      const result = await runStalledSignupDigest(NOW);

      expect(dispatch).toHaveBeenCalledWith(31);
      expect(dispatch).toHaveBeenCalledWith(32);
      expect(result.alertsRecovered).toBe(2);
    });

    it("counts only actual sends as recovered", async () => {
      sweep.mockResolvedValue([31, 32]);
      dispatch.mockResolvedValueOnce("sent").mockResolvedValueOnce("already-sent");

      const result = await runStalledSignupDigest(NOW);

      expect(result.alertsRecovered).toBe(1);
    });

    it("still sends the digest when the sweep query blows up", async () => {
      sweep.mockRejectedValue(new Error("db hiccup"));

      const result = await runStalledSignupDigest(NOW);

      expect(result.sent).toBe(true);
      expect(result.alertsRecovered).toBe(0);
      expect(sendDigest).toHaveBeenCalledTimes(1);
    });

    it("runs even on a day the digest itself has nothing new", async () => {
      getReport.mockResolvedValue(report([person({ isNewToDigest: false })]));
      sweep.mockResolvedValue([31]);

      const result = await runStalledSignupDigest(NOW);

      expect(result).toMatchObject({ sent: false, reason: "nothing-new", alertsRecovered: 1 });
      expect(dispatch).toHaveBeenCalledWith(31);
    });

    it("does not run when the kill switch is off", async () => {
      delete process.env.SIGNUP_NOTIFY_ENABLED;

      await runStalledSignupDigest(NOW);

      expect(sweep).not.toHaveBeenCalled();
    });
  });

  describe("failure handling", () => {
    it("marks the new arrivals as reported only AFTER a successful send", async () => {
      const order: string[] = [];
      sendDigest.mockImplementation(async () => {
        order.push("send");
      });
      mark.mockImplementation(async () => {
        order.push("mark");
      });

      await runStalledSignupDigest(NOW);

      expect(order).toEqual(["send", "mark"]);
    });

    it("marks NOBODY when the send fails, so tomorrow retries", async () => {
      sendDigest.mockRejectedValue(new Error("Resend is down"));

      const result = await runStalledSignupDigest(NOW);

      expect(result).toMatchObject({ sent: false, reason: "send-failed" });
      expect(mark).not.toHaveBeenCalled();
    });

    it("sends when the ONLY new arrival is a never-finished sign-in", async () => {
      // Group A alone must be able to trigger the email — it is the group the
      // digest was re-sourced for.
      getReport.mockResolvedValue(
        report([person({ userId: 1, isNewToDigest: false })], [signIn()])
      );

      const result = await runStalledSignupDigest(NOW);

      expect(result.sent).toBe(true);
      expect(sendDigest).toHaveBeenCalledTimes(1);
    });

    it("records the reported addresses after a successful send", async () => {
      getReport.mockResolvedValue(
        report(
          [],
          [
            signIn({ email: "new@example.com", isNewToDigest: true }),
            signIn({ email: "old@example.com", isNewToDigest: false }),
          ]
        )
      );

      await runStalledSignupDigest(NOW);

      expect(markSignIns).toHaveBeenCalledWith(["new@example.com"], NOW);
    });

    it("records NO addresses when the send fails", async () => {
      getReport.mockResolvedValue(report([], [signIn()]));
      sendDigest.mockRejectedValue(new Error("Resend is down"));

      await runStalledSignupDigest(NOW);

      expect(markSignIns).not.toHaveBeenCalled();
      expect(mark).not.toHaveBeenCalled();
    });

    it("counts both groups in the totals", async () => {
      getReport.mockResolvedValue(
        report(
          [person({ userId: 1, isNewToDigest: true }), person({ userId: 2, isNewToDigest: false })],
          [signIn({ email: "a@example.com", isNewToDigest: true })]
        )
      );

      const result = await runStalledSignupDigest(NOW);

      expect(result).toMatchObject({ stalled: 3, newlyStalled: 2, stalledSignIns: 1 });
      expect(sendDigest.mock.calls[0]?.[0]).toMatchObject({ newCount: 2, totalCount: 3 });
    });

    it("marks only the people who were actually new", async () => {
      getReport.mockResolvedValue(
        report([
          person({ userId: 11, isNewToDigest: true }),
          person({ userId: 22, isNewToDigest: false }),
          person({ userId: 33, isNewToDigest: true }),
        ])
      );

      await runStalledSignupDigest(NOW);

      expect(mark).toHaveBeenCalledWith([11, 33], NOW);
    });
  });
});
