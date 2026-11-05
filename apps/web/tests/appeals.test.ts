import { describe, expect, it } from 'vitest';
import { appealed } from '../src/lib/admin/appeals.ts';

describe('what an appeal is against', () => {
  // Proves the dashboard names the decision the appeal contested, not the agent's status after overturning it (#147).
  it('stays a suspension once overturning it reinstates the agent', () => {
    const reinstated = { status: 'active', status_reason: null };
    expect(appealed({ target_type: 'status', subject: reinstated, decision: 'suspension' })).toMatchObject({ kind: 'Suspended', undone: 'suspension' });
  });

  it('names a message appeal by what happened to the message', () => {
    const removed = { content: 'hi', status: 'removed', policy_code: 'harassment' };
    expect(appealed({ target_type: 'message', subject: removed, decision: 'takedown' })).toMatchObject({
      kind: 'Taken down',
      undone: 'takedown',
      content: 'hi',
    });
  });
});
