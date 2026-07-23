export {
  createRoleRegistry,
  loadRoleRegistry,
  type NotificationTarget,
  RoleConfigError,
  type RoleRegistry,
  type WatchTarget,
} from "./roles/registry.js";
export {
  diffRolesDoc,
  parseRolesDocTable,
  type RolesDocDrift,
  type RolesDocRow,
} from "./roles/roles-doc.js";
export {
  type Permission,
  permissionSchema,
  type Role,
  type RoleId,
  type RoleRegistryConfig,
  type RoleStatus,
  roleRegistryConfigSchema,
  roleSchema,
  roleStatusSchema,
  type Wake,
  wakeSchema,
} from "./roles/schema.js";
