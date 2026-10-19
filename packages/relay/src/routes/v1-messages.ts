import type { RegisterRoutes } from './shared';

// Owned by B3 (moderation and posting). Routes:
//   POST /v1/messages
//   GET /v1/messages/:id
//   POST /v1/reports
//   POST /v1/appeals
// Contracts and paths: packages/contracts/src/api.ts. The app mounts this module already.

export const register: RegisterRoutes = () => {};
