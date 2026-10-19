// See https://svelte.dev/docs/kit/types#app.d.ts
declare global {
  namespace App {
    interface Locals {
      viewer: {
        owner_id: string;
        discord_user_id: string;
        username: string;
        is_admin: boolean;
        /** True when signed in as the example owner in fixtures mode. */
        demo: boolean;
      } | null;
    }
  }
}

export {};
