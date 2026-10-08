import { describe, it, expect } from "@jest/globals";
import {
  clusterSessionWindows,
  overlapsAnySession,
  SESSION_PAD_MS,
} from "@/utils/session-overlap";

const t = (iso: string) => Date.parse(iso);
const MIN = 60 * 1000;

describe("clusterSessionWindows", () => {
  it("pads one sitting on both ends", () => {
    const [w] = clusterSessionWindows([
      t("2026-10-08T14:10:00Z"),
      t("2026-10-08T14:50:00Z"),
    ]);
    expect(w.start).toBe(t("2026-10-08T14:10:00Z") - SESSION_PAD_MS);
    expect(w.end).toBe(t("2026-10-08T14:50:00Z") + SESSION_PAD_MS);
  });

  it("splits a set added days later into its own window", () => {
    // A min→max span would cover two days and swallow every walk in between.
    const windows = clusterSessionWindows([
      t("2026-10-05T14:00:00Z"),
      t("2026-10-07T20:00:00Z"),
      t("2026-10-05T14:20:00Z"), // unsorted on purpose
    ]);
    expect(windows).toHaveLength(2);
    expect(overlapsAnySession(t("2026-10-06T12:00:00Z"), t("2026-10-06T13:00:00Z"), windows)).toBe(false);
  });

  it("keeps sets up to 90 minutes apart in one sitting", () => {
    // A 45-minute cardio exercise between two sets must not split a session.
    expect(
      clusterSessionWindows([t("2026-10-08T14:00:00Z"), t("2026-10-08T15:30:00Z")])
    ).toHaveLength(1);
    expect(
      clusterSessionWindows([t("2026-10-08T14:00:00Z"), t("2026-10-08T15:31:00Z")])
    ).toHaveLength(2);
  });

  it("returns nothing for no logged sets", () => {
    expect(clusterSessionWindows([])).toEqual([]);
  });
});

describe("overlapsAnySession", () => {
  const windows = clusterSessionWindows([t("2026-10-08T14:10:00Z"), t("2026-10-08T14:50:00Z")]);

  it("catches a watch workout started before the first set", () => {
    expect(overlapsAnySession(t("2026-10-08T14:00:00Z"), t("2026-10-08T15:00:00Z"), windows)).toBe(true);
  });

  it("catches a single-exercise session logged only at the end", () => {
    // A MastersFit walking day: one exercise, logged when it was done.
    const end = clusterSessionWindows([t("2026-10-08T09:30:00Z")]);
    expect(overlapsAnySession(t("2026-10-08T09:00:00Z"), t("2026-10-08T09:28:00Z"), end)).toBe(true);
  });

  it("keeps a walk that ended well before the session", () => {
    expect(overlapsAnySession(t("2026-10-08T12:00:00Z"), t("2026-10-08T12:45:00Z"), windows)).toBe(false);
  });

  it("keeps a walk that started after the padding ran out", () => {
    const start = t("2026-10-08T14:50:00Z") + SESSION_PAD_MS + MIN;
    expect(overlapsAnySession(start, start + 30 * MIN, windows)).toBe(false);
  });
});
