import { describe, expect, it } from 'vitest';
import { configProblems, type ConfigValues } from '../src/lib/server/config-check.ts';

const ready: ConfigValues = {
  PUBLIC_URL: 'https://logitland.net',
  SESSION_SECRET: 'x'.repeat(32),
  INTERNAL_TOKEN: 'q8Zr0v3mT9bWk2LxN7cYh5JdFs1GaP4e',
  DEV_SIGN_IN: '',
  DATA_SOURCE: 'relay',
  OPERATOR_NAME: 'Logitland',
  CONTACT_EMAIL: 'privacy@logitland.net',
};

describe('configProblems', () => {
  it('accepts a complete configuration', () => {
    expect(configProblems(ready)).toEqual([]);
  });

  it('checks nothing on a local PUBLIC_URL', () => {
    expect(configProblems({ PUBLIC_URL: 'http://localhost:5173', DATA_SOURCE: 'fixtures', DEV_SIGN_IN: 'true' })).toEqual([]);
    expect(configProblems({ PUBLIC_URL: 'http://dashboard.test' })).toEqual([]);
  });

  it('names each problem and no value', () => {
    expect(configProblems({ ...ready, SESSION_SECRET: 'short' })).toEqual(['SESSION_SECRET must be at least 32 characters']);
    expect(configProblems({ ...ready, INTERNAL_TOKEN: '' })).toEqual(['INTERNAL_TOKEN is missing']);
    expect(configProblems({ ...ready, INTERNAL_TOKEN: 'dev-internal-token' })).toEqual(['INTERNAL_TOKEN is still an example value']);
    expect(configProblems({ ...ready, DEV_SIGN_IN: 'true' })).toEqual(['DEV_SIGN_IN must not be set']);
    expect(configProblems({ ...ready, DATA_SOURCE: 'fixtures' })).toEqual(['DATA_SOURCE must be relay']);
    expect(configProblems({ ...ready, PUBLIC_URL: 'https://REPLACE.invalid' })).toEqual(['PUBLIC_URL is still a placeholder']);
    expect(configProblems({ ...ready, PUBLIC_URL: 'http://logitland.net' })).toEqual(['PUBLIC_URL must use https']);
    expect(configProblems({ ...ready, PUBLIC_URL: 'nonsense' })).toEqual(['PUBLIC_URL is not a URL']);
  });

  it('refuses the placeholder operator and contact', () => {
    expect(configProblems({ ...ready, OPERATOR_NAME: 'REPLACE with the operator name' })).toEqual(['OPERATOR_NAME is a placeholder']);
    expect(configProblems({ ...ready, OPERATOR_NAME: 'Logitland (local development)' })).toEqual(['OPERATOR_NAME is a placeholder']);
    expect(configProblems({ ...ready, OPERATOR_NAME: '' })).toEqual(['OPERATOR_NAME is a placeholder']);
    expect(configProblems({ ...ready, CONTACT_EMAIL: 'privacy@example.invalid' })).toEqual(['CONTACT_EMAIL is a placeholder']);
    expect(configProblems({ ...ready, CONTACT_EMAIL: 'REPLACE' })).toEqual(['CONTACT_EMAIL is a placeholder']);
    expect(configProblems({ ...ready, CONTACT_EMAIL: '' })).toEqual(['CONTACT_EMAIL is a placeholder']);
  });

  it('reports every problem at once', () => {
    expect(configProblems({ PUBLIC_URL: 'https://REPLACE.invalid' }).length).toBeGreaterThanOrEqual(6);
  });
});
