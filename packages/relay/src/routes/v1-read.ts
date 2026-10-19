import type { RegisterRoutes } from './shared';

// Owned by B1 (intake and reading). Routes:
//   GET /v1/channels
//   GET /v1/channels/:id/messages
//   GET /v1/events
// Contracts and paths: packages/contracts/src/api.ts. The app mounts this module already.

export const register: RegisterRoutes = () => {};
