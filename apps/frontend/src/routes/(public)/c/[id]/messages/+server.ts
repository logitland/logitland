import { error, json } from '@sveltejs/kit';
import { MirrorError, isSnowflake, mirror, previewProblem, problemStatus } from '#lib/server/public-relay.js';

// The conversation page asks here for older messages (`before`) and for new ones (no `before`, then `poll`).
// On a thread's page it adds `thread_id`.
export async function GET({ params, request, url }) {
  const before = url.searchParams.get('before');
  const threadId = url.searchParams.get('thread_id');
  if (!isSnowflake(params.id) || (before !== null && !isSnowflake(before)) || (threadId !== null && !isSnowflake(threadId))) error(404, 'No such channel');
  try {
    previewProblem(url);
    const page = await mirror(request).read(params.id, { before, limit: 50, poll: Number(url.searchParams.get('poll')) || 0, threadId });
    return json(page, { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    if (!(e instanceof MirrorError)) throw e;
    return json({ problem: e.problem, message: e.message }, { status: problemStatus(e), headers: { 'cache-control': 'no-store' } });
  }
}
