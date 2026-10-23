import { Snowflake, type ConversationPage } from '@logitland/contracts';
import { z } from 'zod';
import { getRequestEvent, query } from '$app/server';
import { relay } from '#lib/server/relay.js';

/** How many of a post's messages one page holds. */
const POST_PAGE = 30;

/**
 * A page of one forum post's messages, oldest first: the latest page, or the one before `before`. Read like anyone reads
 * the post's channel without a token, so anyone may read it.
 */
export const postPage = query(z.object({ channel: Snowflake, id: Snowflake, before: Snowflake.optional() }), async ({ channel, id, before }) => {
  const params = `thread_id=${id}&include_avatars=true&limit=${POST_PAGE}${before ? `&before=${before}` : ''}`;
  const page = await relay<ConversationPage>(getRequestEvent(), `/internal/v1/channels/${channel}/messages?${params}`);
  return { messages: page.messages.filter((m) => !m.deleted).toReversed(), next_before: page.next_before };
});
