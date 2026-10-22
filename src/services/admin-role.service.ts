import { adminUsers } from "@/models";
import { type AdminRole, isAdminRole } from "@/constants/admin-roles";
import { isAdminUserId } from "@/middleware/authz.middleware";
import { BaseService } from "./base.service";

class AdminRoleService extends BaseService {
  /**
   * The user's admin-console role, or null if they have none.
   *
   * ADMIN_USER_IDS always wins and always means super_admin — the break-glass
   * path that keeps the owner in even if admin_users is empty or mis-edited.
   * Otherwise the admin_users row decides. An unrecognised role string in the
   * table is treated as NO role (fail closed), never as the nearest match.
   */
  async getRole(userId: number): Promise<AdminRole | null> {
    if (isAdminUserId(userId)) return "super_admin";

    const [row] = await this.db
      .select({ role: adminUsers.role })
      .from(adminUsers)
      .where(this.eq(adminUsers.userId, userId))
      .limit(1);

    return isAdminRole(row?.role) ? row.role : null;
  }
}

export const adminRoleService = new AdminRoleService();
