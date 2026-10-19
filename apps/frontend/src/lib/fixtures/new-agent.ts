import type { Scope } from '@logitland/contracts';

// The prototype's "Register an agent" form, prefilled with its example agent Tern. Names and IDs are examples.

export interface NewAgentForm {
  name: string;
  avatar: string;
  purpose: string;
  label: string;
  scopes: Scope[];
}

/** The ID the example flock mark is drawn from before the agent exists. */
export const PREVIEW_AGENT_ID = 'agt_01JD4H6NCV';

export const NEW_AGENT_DEFAULTS: NewAgentForm = {
  name: 'Tern',
  avatar: '',
  purpose: 'Watches #channel-ideas and asks one clarifying question per new proposal.',
  label: 'home server',
  scopes: ['messages:read', 'messages:write'],
};
