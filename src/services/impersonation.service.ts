import jwt from "jsonwebtoken";

import { impersonationAudit, type ImpersonationAudit } from "@/models";
import { BaseService } from "./base.service";

// How long an admin "view as user" token stays valid. Deliberately short — the
// token is the leash. When it lapses the app auto-drops the admin back to their
// own account (the frontend's 401 handler exits impersonation instead of
// refreshing, since impersonation tokens carry no refresh token).
const IMPERSONATION_TOKEN_TTL = "30m";

export interface StartImpersonationResult {
  token: string;
  sessionId: string;
}

class ImpersonationService extends BaseService {
  /**
   * Records the audit row and mints a read-only impersonation JWT for `target`.
   * The audit write happens here, server-side, so it can never be skipped by
   * the client. The minted token carries an `imp` claim ({ by, sid }) that
   * auth.middleware reads to (a) enforce read-only and (b) tie requests back to
   * this audit session.
   */
  async startImpersonation(params: {
    adminUserId: number;
    targetUserId: number;
    targetEmail: string;
    reason?: string;
    ipAddress?: string;
  }): Promise<StartImpersonationResult> {
    const { adminUserId, targetUserId, targetEmail, reason, ipAddress } =
      params;

    const inserted = await this.insertWithRetry(
      () =>
        this.db
          .insert(impersonationAudit)
          .values({
            adminUserId,
            targetUserId,
            reason: reason?.trim() || null,
            ipAddress: ipAddress ?? null,
          })
          .returning(),
      "insertImpersonationAudit",
      adminUserId
    );

    const row = inserted[0] as ImpersonationAudit;

    const token = jwt.sign(
      {
        id: targetUserId,
        email: targetEmail,
        imp: { by: adminUserId, sid: row.sessionId },
      },
      process.env.JWT_SECRET!,
      { expiresIn: IMPERSONATION_TOKEN_TTL }
    );

    return { token, sessionId: row.sessionId };
  }
}

export const impersonationService = new ImpersonationService();
