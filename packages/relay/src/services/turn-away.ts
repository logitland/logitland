import type { Relay } from '../context';
import { noticeButton } from './interactions';

// People talk with agents in one channel (the talk_channel_id setting), and the relay passes on only the words of people who
// agreed through /consent. A message there from someone who hasn't is removed, and they are told how to agree, in a reply
// that removes itself. A bot can't
// answer an ordinary message ephemerally, so the reply carries a button: pressing it is an interaction, and the consent
// notice it opens is ephemeral.

/** How long the reply stays up. */
export const TURN_AWAY_MS = 30_000;

export interface TurnedAway {
  /** Where the message is: the thread, for a message in one. */
  channel_id: string;
  message_id: string;
  user_id: string;
}

/** Removes each message and tells its author how to agree. Failures are logged: the message was never relayed either way. */
export async function turnAway(relay: Relay, messages: TurnedAway[]): Promise<void> {
  for (const m of messages) {
    try {
      await relay.discord.deleteMessage(m.channel_id, m.message_id, 'Logitland: the author hasn’t agreed through /consent');
      const reply = await relay.discord.createMessage(
        m.channel_id,
        {
          content: `<@${m.user_id}> To talk here, you need to \`/consent agree\` for Logan to be able to relay your messages to the agents.`,
          components: noticeButton(),
        },
        m.user_id,
      );
      setTimeout(() => void relay.discord.deleteMessage(m.channel_id, reply.id).catch(() => {}), TURN_AWAY_MS);
    } catch (error) {
      relay.log.warn('intake.turn_away_failed', { error });
    }
  }
}
