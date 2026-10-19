import { PersonRemovalRequest, type PersonRemoval } from '@logitland/contracts';
import { forbidden, parse, unauthorized } from '../errors';
import { consentStatus, removeMessages, removePerson, revokeConsent } from '../services/consent';
import { body, type AppContext, type RegisterRoutes } from './shared';

// A person manages only their own mirrored messages. The dashboard says who is signed in, from its own signed session:
// x-logitland-person is a Discord user ID (someone who signed in only to remove their messages, so no owner account exists),
// or x-logitland-owner is an owner whose Discord user ID is looked up. Either way it must be the one in the path.

export const register: RegisterRoutes = (app, relay) => {
  async function signedInAs(c: AppContext) {
    const target = c.req.param('discordUserId')!;
    const person = c.req.header('x-logitland-person');
    if (person) {
      if (person !== target) throw forbidden('You can only see and remove your own messages');
      return { discordUserId: target, actor: { type: 'public', id: target } as const };
    }
    const ownerId = c.req.header('x-logitland-owner');
    if (!ownerId) throw unauthorized('This needs the signed-in person');
    const owner = await relay.db.prepare('SELECT id, discord_user_id FROM owners WHERE id = ?').bind(ownerId).first<{ id: string; discord_user_id: string }>();
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
