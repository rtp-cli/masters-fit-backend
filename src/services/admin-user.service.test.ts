import { describe, it, expect } from "@jest/globals";
import { adminUserService } from "./admin-user.service";

describe("adminUserService.platformSplit", () => {
  it("counts real users by latest platform; internal accounts and junk values handled", async () => {
    (adminUserService as any).db = {
      execute: async () => ({
        rows: [
          { email: "a@gmail.com", platform: "ios" },
          { email: "b@gmail.com", platform: "ios" },
          { email: "c@gmail.com", platform: "android" },
          { email: "+13125550123", platform: null }, // phone-only, never opened since tracking began
          { email: "d@gmail.com", platform: "blackberry" }, // unrecognised → unknown, not dropped
          { email: "rtp+qa@mastersfit.ai", platform: "ios" }, // internal → excluded
          { email: "dev@conradlabs.com", platform: "android" }, // internal → excluded
        ],
      }),
    };

    expect(await adminUserService.platformSplit()).toEqual({
      ios: 2,
      android: 1,
      web: 0,
      unknown: 2,
      total: 5,
    });
  });
});
