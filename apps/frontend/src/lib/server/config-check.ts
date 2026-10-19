// The dashboard fails closed: outside a local PUBLIC_URL it serves nothing until its configuration is complete.
// Messages name the problem only, never a value, because they are logged.

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$|\.(localhost|test)$/;
const PLACEHOLDER = /(^|\.)(invalid|example)$|replace/i;
const PLACEHOLDER_TOKENS = ['dev-internal-token', 'test-internal-token', 'changeme', 'change-me', 'replace-me'];

export interface ConfigValues {
  PUBLIC_URL?: string;
  SESSION_SECRET?: string;
  INTERNAL_TOKEN?: string;
  DEV_SIGN_IN?: string;
  DATA_SOURCE?: string;
  OPERATOR_NAME?: string;
  CONTACT_EMAIL?: string;
}

function hostOf(url: string | undefined): string | null {
  try {
    return new URL(url ?? '').hostname;
  } catch {
    return null;
  }
}

/** What stops the dashboard from serving, or an empty list. A local PUBLIC_URL is development and is never checked. */
export function configProblems(env: ConfigValues): string[] {
  const host = hostOf(env.PUBLIC_URL);
  if (host && LOCAL.test(host)) return [];
  const problems: string[] = [];
  if (!host) problems.push('PUBLIC_URL is not a URL');
  else {
    if (!env.PUBLIC_URL!.startsWith('https://')) problems.push('PUBLIC_URL must use https');
    if (PLACEHOLDER.test(host)) problems.push('PUBLIC_URL is still a placeholder');
  }
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) problems.push('SESSION_SECRET must be at least 32 characters');
  if (!env.INTERNAL_TOKEN) problems.push('INTERNAL_TOKEN is missing');
  else if (PLACEHOLDER_TOKENS.some((p) => env.INTERNAL_TOKEN!.toLowerCase().startsWith(p))) problems.push('INTERNAL_TOKEN is still an example value');
  if (env.DEV_SIGN_IN) problems.push('DEV_SIGN_IN must not be set');
  if (env.DATA_SOURCE !== 'relay') problems.push('DATA_SOURCE must be relay');
  if (!env.OPERATOR_NAME?.trim() || PLACEHOLDER.test(env.OPERATOR_NAME) || /local development/i.test(env.OPERATOR_NAME))
    problems.push('OPERATOR_NAME is a placeholder');
  const email = env.CONTACT_EMAIL?.trim() ?? '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || PLACEHOLDER.test(email.split('@')[1] ?? '') || /replace/i.test(email))
    problems.push('CONTACT_EMAIL is a placeholder');
  return problems;
}
