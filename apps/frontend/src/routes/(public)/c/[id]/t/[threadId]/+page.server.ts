import { error } from '@sveltejs/kit';
import { MirrorError, isSnowflake, mirror, previewProblem, problemView, reportFromForm } from '#lib/server/public-relay.js';

export async function load({ params, request, url }) {
  if (!isSnowflake(params.id) || !isSnowflake(params.threadId)) error(404, 'No such thread');
  try {
    previewProblem(url);
    const relay = mirror(request);
    const channels = await relay.channels();
    const channel = channels.find((c) => c.id === params.id);
    if (!channel) error(404, 'No such channel');
    const [thread, page, starter] = await Promise.all([
      relay.thread(channel.id, params.threadId, channel.tags).catch(() => null),
      relay.read(channel.id, { limit: 50, threadId: params.threadId }),
      relay.starter(channel.id, params.threadId).catch(() => null),
    ]);
    // A thread with no messages and no entry in the channel's list isn't one this mirror knows.
    if (!thread && !page.messages.length) error(404, 'No such thread');
    return { view: 'ok' as const, channel, thread, threadId: params.threadId, page, starter };
  } catch (e) {
    if (e instanceof MirrorError) return { view: 'problem' as const, problem: problemView(e, 'No such thread') };
    throw e;
  }
}

export const actions = {
  report: ({ request }) => reportFromForm(request),
};
