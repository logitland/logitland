import { ButtonStyle, Component, IS_COMPONENTS_V2, type CreateMessageBody } from '@logitland/discord';

// What the relay and Logan post for staff (#147) are cards: one Components V2 container each, with a headline, its text, a
// quote under a divider and a row of buttons, all but the text optional. A card staff act on has Dismiss, which collapses it to
// one line with Reopen; Reopen shows the whole card again as it reads now. Both buttons name the card by kind and reference
// (`staff_dismiss:strike:<source key>`), and interactions.ts rebuilds it from the rows behind it.
// https://docs.discord.com/developers/components/reference

/** Accents, the dark theme's: brand for what asks staff to act, then the moderation and health states. */
export const Accent = { brand: 0xff55ff, destructive: 0xf66d67, warning: 0xeeb154, success: 0x6fd087 } as const;

/** The kinds of card staff can dismiss, each rebuilt from its own rows. */
export type CardKind = 'bot' | 'strike';

export interface Button {
  type: typeof Component.button;
  style: number;
  label: string;
  url?: string;
  custom_id?: string;
}

export interface Card {
  /** The headline, and all that is left of the card once dismissed. */
  title?: string;
  text: string[];
  /** Quoted text, under a divider. */
  quote?: string;
  buttons?: Button[];
  /** A card staff act on: what Dismiss and Reopen rebuild it from. */
  dismiss?: { kind: CardKind; ref: string };
  accent?: number;
}

const DISMISS = 'staff_dismiss:';
const REOPEN = 'staff_reopen:';

export const linkButton = (label: string, url: string): Button => ({ type: Component.button, style: ButtonStyle.link, label, url });

const text = (content: string) => ({ type: Component.textDisplay, content });
const container = (card: Pick<Card, 'accent'>, components: unknown[]): CreateMessageBody => ({
  flags: IS_COMPONENTS_V2,
  components: [{ type: Component.container, ...(card.accent === undefined ? {} : { accent_color: card.accent }), components }],
});

/** The whole card. */
export function cardMessage(card: Card): CreateMessageBody {
  const buttons = [...(card.buttons ?? [])];
  if (card.dismiss)
    buttons.push({ type: Component.button, style: ButtonStyle.secondary, label: 'Dismiss', custom_id: `${DISMISS}${card.dismiss.kind}:${card.dismiss.ref}` });
  return container(card, [
    ...(card.title ? [text(`### ${card.title}`)] : []),
    ...card.text.map(text),
    ...(card.quote ? [{ type: Component.separator, divider: true, spacing: 1 }, text(card.quote)] : []),
    ...(buttons.length ? [{ type: Component.actionRow, components: buttons }] : []),
  ]);
}

/** A dismissed card: its headline, who dismissed it, and Reopen. */
export function dismissedMessage(title: string, dismiss: NonNullable<Card['dismiss']>, by: string): CreateMessageBody {
  const reopen = { type: Component.button, style: ButtonStyle.secondary, label: 'Reopen', custom_id: `${REOPEN}${dismiss.kind}:${dismiss.ref}` };
  return container({}, [{ type: Component.section, components: [text(`${title} · Dismissed by <@${by}>`)], accessory: reopen }]);
}

/** A press on Dismiss or Reopen, read from its custom_id; null for any other button. */
export function cardButton(customId: string | undefined): { dismiss: boolean; kind: CardKind; ref: string } | null {
  const dismiss = customId?.startsWith(DISMISS);
  if (!customId || (!dismiss && !customId.startsWith(REOPEN))) return null;
  const [kind, ...ref] = customId.slice((dismiss ? DISMISS : REOPEN).length).split(':');
  if ((kind !== 'bot' && kind !== 'strike') || !ref.length) return null;
  return { dismiss: Boolean(dismiss), kind, ref: ref.join(':') };
}
