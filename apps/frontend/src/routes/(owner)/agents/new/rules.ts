// Validation for "Register an agent", shared by the create action and the page (which re-checks a marked
// field as it's corrected). The relay's own contract decides what's valid; the copy is the prototype's.
import { CreateAgentRequest, type Scope } from '@logitland/contracts';

/** In page order, so the first invalid one can take focus. */
export const FIELDS = ['name', 'avatar', 'purpose', 'label', 'scope'] as const;
export type Field = (typeof FIELDS)[number];
export type FieldErrors = Partial<Record<Field, string>>;

export interface NewAgentValues {
  name: string;
  avatar: string;
  purpose: string;
  label: string;
  scopes: string[];
}

export interface CreatedAgent {
  name: string;
  label: string;
  key: { id: string; secret: string; scopes: Scope[] };
}

export function readValues(data: FormData): NewAgentValues {
  const text = (k: string) => String(data.get(k) ?? '');
  return {
    name: text('name'),
    avatar: text('avatar'),
    purpose: text('purpose'),
    label: text('label'),
    scopes: data.getAll('scope').map(String),
  };
}

// The dashboard asks for a description, which the relay leaves optional.
const Request = CreateAgentRequest.required({ description: true });

/** Request fields (and relay problem paths) to form fields. */
export const FIELD_OF: Record<string, Field> = { name: 'name', avatar_url: 'avatar', description: 'purpose', key_label: 'label', scopes: 'scope' };

function message(field: Field, issue: 'big' | 'small' | 'other'): string {
  switch (field) {
    case 'name':
      return issue === 'big' ? 'Use 32 characters or fewer.' : 'Enter a name of 2 to 32 characters.';
    case 'avatar':
      return 'Enter a full https:// address, or leave it empty.';
    case 'purpose':
      return issue === 'big' ? 'Use 280 characters or fewer.' : 'Describe what it does in a sentence.';
    case 'label':
      return issue === 'big' ? 'Use 60 characters or fewer.' : 'Enter a label so you can tell this key apart later.';
    case 'scope':
      return 'Choose at least one permission.';
  }
}

export function validate(v: NewAgentValues) {
  const errors: FieldErrors = {};
  const label = v.label.trim();
  const parsed = Request.safeParse({
    name: v.name,
    description: v.purpose.trim() || undefined,
    avatar_url: v.avatar.trim() || undefined,
    scopes: v.scopes,
    key_label: label || undefined,
  });
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = FIELD_OF[String(issue.path[0])];
      if (field && !errors[field]) errors[field] = message(field, issue.code === 'too_big' ? 'big' : issue.code === 'too_small' ? 'small' : 'other');
    }
  }
  // The relay leaves the key label optional; the dashboard asks for one so keys can be told apart.
  if (!label) errors.label = message('label', 'small');
  if (!parsed.success || errors.label) return { ok: false as const, errors };
  return { ok: true as const, request: parsed.data, errors };
}
