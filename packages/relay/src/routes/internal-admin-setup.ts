import { RelayChannelRequest } from '@logitland/contracts';
import { invalid, parse } from '../errors';
import { listDiscordChannels, registerCommands, relayChannel, runSetup } from '../services/setup';
import { body, type RegisterRoutes } from './shared';

// Admin setup: a checklist of what the relay needs from Discord, and one-press fixes for the parts Discord lets the bot do.

export const register: RegisterRoutes = (app, relay) => {
  app.get('/internal/admin/setup', async (c) => c.json(await runSetup(relay)));

  app.get('/internal/admin/discord/channels', async (c) => c.json(await listDiscordChannels(relay)));

  app.post('/internal/admin/discord/channels/:channelId/relay', async (c) => {
    const channelId = c.req.param('channelId');
    if (!/^\d{17,20}$/.test(channelId)) throw invalid('Channel IDs are Discord snowflakes: 17 to 20 digits.');
    const req = parse(RelayChannelRequest, await body(c));
    const { created, ...result } = await relayChannel(relay, c.get('admin').id, channelId, req);
    return c.json(result, created ? 201 : 200);
  });

  app.post('/internal/admin/discord/commands', async (c) => c.json(await registerCommands(relay, c.get('admin').id)));
};
