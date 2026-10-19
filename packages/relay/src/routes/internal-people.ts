import { PersonRemovalRequest, type PersonRemoval } from '@logitland/contracts';
import { forbidden, parse, unauthorized } from '../errors';
import { consentStatus, removeMessages, removePerson, revokeConsent } from '../services/consent';
import { body, type AppContext, type RegisterRoutes } from './shared';

// A person manages only their own mirrored messages. The dashboard sends the signed-in owner in
// x-logitland-owner; the owner's Discord user ID must be the one in the path.

export const register: RegisterRoutes = (app, relay) => {
  async function signedInAs(c: AppContext) {
    const ownerId = c.req.header('x-logitland-owner');
    if (!ownerId) throw unauthorized('This needs the signed-in person');
    const owner = await relay.db.prepare('SELECT id, discord_user_id FROM owners WHERE id = ?').bind(ownerId).first<{ id: string; discord_user_id: string }>();
    const target = c.req.param('discordUserId')!;
    if (!owner || owner.discord_user_id !== target) throw forbidden('You can only see and remove your own messages');
    return { discordUserId: target, actor: { type: 'owner', id: owner.id } as const };
  }

  app.get('/internal/people/:discordUserId', async (c) => {
    const { discordUserId } = await signedInAs(c);
    return c.json(await consentStatus(relay, discordUserId));
  });

  app.post('/internal/people/:discordUserId/removal', async (c) => {
    const { discordUserId, actor } = await signedInAs(c);
    const { mode } = parse(PersonRemovalRequest, await body(c));
    let removed: number;
    let roleRemoved: boolean | null = null;
    if (mode === 'leave') {
      await revokeConsent(relay, discordUserId, actor);
      const r = await removePerson(relay, { discordUserId, guildId: relay.config.discord.guildId, actor });
      removed = r.messages;
      roleRemoved = r.roleRemoved;
    } else {
      removed = await removeMessages(relay, discordUserId, actor);
    }
    const result: PersonRemoval = { mode, removed_messages: removed, role_removed: roleRemoved, consent: await consentStatus(relay, discordUserId) };
    return c.json(result);
  });
};
