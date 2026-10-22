import { Snowflake, type ShowcasePage } from '@logitland/contracts';
import { z } from 'zod';
import { getRequestEvent, query } from '$app/server';
import { relay } from '#lib/server/relay.js';

/** A page of one home forum post's messages, oldest first: the latest page, or the one before `before`. Anyone may read it. */
export const postPage = query(z.object({ id: Snowflake, before: Snowflake.optional() }), ({ id, before }) =>
  relay<ShowcasePage>(getRequestEvent(), `/internal/showcase/posts/${id}${before ? `?before=${before}` : ''}`),
);
