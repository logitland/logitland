import { describe, expect, it } from 'vitest';
import { getOperation, operations, permissionTableProblems, searchOperations, source } from './index';

describe('the vendored catalog', () => {
  it('has a sound permission entry for every operation', () => {
    expect(operations).toHaveLength(source.counts.operations);
    expect(permissionTableProblems(operations)).toEqual([]);
  });

  it('finds operations by ID and by plain words', () => {
    expect(getOperation('create_message')).toMatchObject({ method: 'POST', path: '/channels/{channel_id}/messages' });
    expect(searchOperations({ query: 'kick member' }).map((o) => o.operationId)).toContain('delete_guild_member');
    expect(searchOperations({ query: 'get_guild' })[0]?.operationId).toBe('get_guild');
  });
});
