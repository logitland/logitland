import { mirror, previewProblem, problemView } from '#lib/server/public-relay.js';

export async function load({ request, url, setHeaders }) {
  try {
    previewProblem(url);
    const { channels, agents } = await mirror(request).front();
    return { view: 'ok' as const, channels, agents: agents.slice(0, 8) };
  } catch (e) {
    return { view: 'problem' as const, problem: problemView(e, 'Not found', setHeaders) };
  }
}
