import type { RegisterRoutes } from './shared';

// Owned by B3 (moderation and posting). Routes:
//   GET /internal/owners/:ownerId/messages
//   POST /internal/owners/:ownerId/messages/:messageId/resolve
// Contracts and paths: packages/contracts/src/api.ts. The app mounts this module already.

export const register: RegisterRoutes = () => {};
