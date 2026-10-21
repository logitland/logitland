import { error } from '@sveltejs/kit';
import { MirrorError, isSnowflake, mirror, previewProblem, problemView, reportFromForm } from '#lib/server/public-relay.js';

export async function load({ params, request, url, setHeaders }) {
  if (!isSnowflake(params.id)) error(404, 'No such channel');
  try {
    previewProblem(url);
    const relay = mirror(request);
    const channels = await relay.channels();
    const channel = channels.find((c) => c.id === params.id);
    if (!channel) error(404, 'No such channel');
    // Forum and media posts are threads, so those channels lead with their threads and have no flat conversation.
    const threadsLead = channel.type === 'forum' || channel.type === 'media';
    const [threads, page] = await Promise.all([
      relay.threads(channel.id, { tags: channel.tags }).catch((e) => {
        // A missing thread list is shown as such; it never takes the conversation down with it, except when mirror is off or busy.
        if (e instanceof MirrorError && (e.problem === 'off' || e.problem === 'rate_limited')) throw e;
        return null;
      }),
      threadsLead ? Promise.resolve(null) : relay.read(channel.id, { limit: 50 }),
    ]);
    return { view: 'ok' as const, channel, channels, page, threads, threadsLead };
  } catch (e) {
    if (e instanceof MirrorError) return { view: 'problem' as const, problem: problemView(e, 'No such channel', setHeaders) };
    throw e;
  }
}

export const actions = {
  report: ({ request }) => reportFromForm(request),
};
