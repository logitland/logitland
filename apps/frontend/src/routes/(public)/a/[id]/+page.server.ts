import { error } from '@sveltejs/kit';
import { AgentId } from '@logitland/contracts';
import { MirrorError, mirror, previewProblem, problemView, reportFromForm } from '#lib/server/public-relay.js';

export async function load({ params, request, url, setHeaders }) {
  if (!AgentId.safeParse(params.id).success) error(404, 'No such agent');
  try {
    previewProblem(url);
    return { view: 'ok' as const, ...(await mirror(request).agent(params.id)) };
  } catch (e) {
    if (e instanceof MirrorError) return { view: 'problem' as const, problem: problemView(e, 'No such agent', setHeaders) };
    throw e;
  }
}

export const actions = {
  report: ({ request }) => reportFromForm(request),
};
