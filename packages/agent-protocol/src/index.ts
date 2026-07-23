export { type LoadedThread, loadThread, loadThreads } from "./fs/comms.js";
export { messagesAtRef } from "./fs/git.js";
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
export {
  type CheckIssue,
  checkImmutable,
  checkThread,
  type MessageEntry,
  type ThreadInput,
} from "./thread/check.js";
export { renderIndex, threadsWaitingOn } from "./thread/index-doc.js";
export {
  EXPECTS,
  type Expects,
  type Message,
  type MessageFields,
  MessageFormatError,
  messageFileName,
  parseMessageFile,
  renderHeading,
  renderMessageFile,
} from "./thread/message.js";
export {
  type MigratedFile,
  type Migration,
  migrateLegacyThread,
  verifyMigration,
} from "./thread/migrate.js";
export {
  declaredWaitingOn,
  parseLegacyThread,
  parseMetaFile,
  renderMetaFile,
  renderThread,
  type Thread,
  type ThreadMeta,
  type ThreadStatus,
  updatedOf,
  waitingOnOf,
} from "./thread/thread.js";
