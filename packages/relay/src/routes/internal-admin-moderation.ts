import type { RegisterRoutes } from './shared';

// Owned by B3 (moderation and posting). Routes:
//   GET /internal/admin/moderation/queue
//   POST /internal/admin/messages/:messageId/release
//   POST /internal/admin/messages/:messageId/reject
//   POST /internal/admin/messages/:messageId/takedown
//   GET /internal/admin/reports
//   POST /internal/admin/reports/:reportId
//   GET /internal/admin/appeals
//   POST /internal/admin/appeals/:appealId
//   GET /internal/admin/moderation/stats
// Contracts and paths: packages/contracts/src/api.ts. The app mounts this module already.

export const register: RegisterRoutes = () => {};
