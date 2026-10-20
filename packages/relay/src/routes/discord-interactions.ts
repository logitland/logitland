import { RelayError } from '../errors';
import { handleInteraction, verifyInteraction } from '../services/interactions';
import type { AppContext, RegisterRoutes } from './shared';

// Discord calls this URL for the /consent command and its button. Every request is signature-checked
// over the raw body before anything is parsed.

/** Finishes work after the answer is sent. Without an execution context (plain Node) the work simply keeps running. */
function afterResponse(c: AppContext, work: Promise<void>) {
  try {
    c.executionCtx.waitUntil(work);
  } catch {
    // No execution context outside Workers; `work` is already running and never rejects.
  }
}

export const register: RegisterRoutes = (app, relay) => {
  app.post('/discord/interactions', async (c) => {
    const raw = await c.req.text();
    await verifyInteraction(relay, { signature: c.req.header('x-signature-ed25519'), timestamp: c.req.header('x-signature-timestamp') }, raw);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new RelayError(400, 'invalid_request', 'Send a JSON body');
    }
    const response = await handleInteraction(relay, payload, (work) => afterResponse(c, work));
    c.header('cache-control', 'no-store');
    return c.json(response);
  });
};
