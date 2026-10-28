import type { Mentions } from '@logitland/contracts';
import { describe, expect, it } from 'vitest';
import { formatTimestamp, plainText, SERVER_READER, segments, type Segment, type TimestampStyle } from '../src/lib/discord-markup.ts';

const LUNA = '200000000000000001';
const MODS = '100000000000000022';
const LOUNGE = '110000000000000001';
const MENTIONS: Mentions = {
  users: { [LUNA]: { name: 'Luna' } },
  roles: { [MODS]: { name: 'mods' } },
  channels: { [LOUNGE]: { name: 'lounge' } },
};
/** 2025-10-27 21:20 UTC, a Monday. */
const AT = 1_761_600_000;

const text = (t: string): Segment => ({ kind: 'text', text: t });
const chip = (t: string): Segment => ({ kind: 'mention', text: t });

describe('Discord markup', () => {
  // Proves each tag reads as Discord shows it, and that text which only resembles a tag stays as written.
  it.each<[string, string, Segment[]]>([
    ['a user', `hi <@${LUNA}>!`, [text('hi '), chip('@Luna'), text('!')]],
    ['a user by nickname', `<@!${LUNA}>`, [chip('@Luna')]],
    ['a role', `<@&${MODS}>`, [chip('@mods')]],
    ['a channel', `see <#${LOUNGE}>`, [text('see '), chip('#lounge')]],
    ['an unknown user', '<@200000000000000009>', [chip('@unknown-user')]],
    ['an unknown role', '<@&100000000000000009>', [chip('@unknown-role')]],
    ['an unknown channel', '<#110000000000000009>', [chip('#unknown')]],
    ['a slash command', '</ask:1100000000000000001>', [chip('/ask')]],
    ['a subcommand', '</xp show:1100000000000000001>', [chip('/xp show')]],
    ['@everyone and @here', '@everyone, @here', [chip('@everyone'), text(', '), chip('@here')]],
    ['an address that contains @here', 'me@here.com', [text('me@here.com')]],
    ['a custom emoji', '<:blob:123>', [{ kind: 'emoji', name: 'blob', src: 'https://cdn.discordapp.com/emojis/123.webp?size=48' }]],
    ['an animated emoji', '<a:wave:456>', [{ kind: 'emoji', name: 'wave', src: 'https://cdn.discordapp.com/emojis/456.webp?size=48&animated=true' }]],
    ['a timestamp with a style', `<t:${AT}:R>`, [{ kind: 'time', at: AT * 1000, style: 'R' }]],
    ['a timestamp without one, as date and time', `<t:${AT}>`, [{ kind: 'time', at: AT * 1000, style: 'f' }]],
    ['tags side by side', `<@${LUNA}><#${LOUNGE}>`, [chip('@Luna'), chip('#lounge')]],
    ['lookalikes', '<@abc> <#> <t:soon> <t:1:X> <:x:1> </:1>', [text('<@abc> <#> <t:soon> <t:1:X> <:x:1> </:1>')]],
    ['a timestamp past what a date holds', '<t:9999999999999>', [text('<t:9999999999999>')]],
  ])('%s', (_, content, expected) => {
    expect(segments(content, MENTIONS)).toEqual(expected);
  });

  // Proves tags still read as unknown when the relay sent no names at all.
  it('reads every tag as unknown without mentions', () => {
    expect(segments(`<@${LUNA}> <@&${MODS}> <#${LOUNGE}>`)).toEqual([chip('@unknown-user'), text(' '), chip('@unknown-role'), text(' '), chip('#unknown')]);
  });

  // Proves each timestamp style matches Discord's, read on the server (English, UTC) so the browser's hydration agrees.
  it.each<[TimestampStyle, string]>([
    ['t', '9:20 PM'],
    ['T', '9:20:00 PM'],
    ['d', '10/27/25'],
    ['D', 'October 27, 2025'],
    ['f', 'October 27, 2025 at 9:20 PM'],
    ['F', 'Monday, October 27, 2025 at 9:20 PM'],
  ])('formats style %s as %s', (style, expected) => {
    expect(formatTimestamp(AT * 1000, style, 0, SERVER_READER).replace(/\s/gu, ' ')).toBe(expected);
  });

  // Proves relative times count from the page's clock, not the machine's, in the largest unit they fill.
  it.each<[number, string]>([
    [AT + 3 * 86_400, '3 days ago'],
    [AT - 61 * 86_400, 'in 2 months'],
    [AT, 'now'],
  ])('formats a relative time against the clock', (clock, expected) => {
    expect(formatTimestamp(AT * 1000, 'R', clock * 1000, SERVER_READER)).toBe(expected);
  });

  // Proves a reply's quote shows names and dates, not markup.
  it('quotes content as plain text', () => {
    expect(plainText(`hey <@${LUNA}>, <t:${AT}:d> <:blob:1>`, MENTIONS, 0, SERVER_READER)).toBe('hey @Luna, 10/27/25 :blob:');
  });
});
