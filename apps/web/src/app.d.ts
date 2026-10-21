// See https://svelte.dev/docs/kit/types#app.d.ts
import type { AdminStanding } from '@logitland/contracts';
import type { Person } from '#lib/fixtures/admin/data.js';
import type { SignedIn } from '#lib/server/session.js';

declare global {
  namespace App {
    interface Locals {
      /** Who the session cookie names (see `#lib/server/session.ts`). */
      owner?: SignedIn;
    }
    interface PageData {
      /** The signed-in person, on dashboard pages (see `#lib/server/dashboard.ts`). */
      person?: Person;
      standing?: AdminStanding;
    }
  }
}

export {};
