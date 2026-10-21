import type { Handler } from './harness';

/** A receiver for `harness().receivers` that keeps every request it gets (headers, body, redirect mode) and answers with `reply`. */
export function recorder(reply: Handler = () => new Response(null, { status: 204 })) {
  const requests: { headers: Headers; body: string; redirect: string; url: string }[] = [];
  const handler: Handler = async (req) => {
    requests.push({ headers: req.headers, body: await req.clone().text(), redirect: req.redirect, url: req.url });
    return reply(req);
  };
  return { requests, handler };
}
