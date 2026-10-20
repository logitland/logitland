// See https://svelte.dev/docs/kit/types#app.d.ts
import type { Person } from '#lib/fixtures/admin/data.js';

declare global {
  namespace App {
    interface Locals {
      /** Who the session cookie names; set only for requests answered with Markdown (see hooks.server.ts). */
      person?: Person;
    }
    interface PageData {
      /** The dashboards' signed-in person when rendering on the server; see `fixtures/session.svelte.ts`. */
      personId?: string | null;
    }
  }
}

export {};
