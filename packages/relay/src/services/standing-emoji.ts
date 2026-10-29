import { encodePng } from '@logitland/sigil';
import type { Relay } from '../context';
import { b64 } from '../crypto';

// The emoji that draw a bot's standing in its owner's DM (bot-standing.ts): a ladder of dots joined by lines, like Discord's
// own Account standing panel. They are application emoji, which the app may use anywhere, DMs included. The relay draws them
// itself (as it draws sigils) and an admin uploads them once from the Health page; until then the DM uses plain characters.
// https://docs.discord.com/developers/resources/emoji#list-application-emojis

type Rgb = readonly [r: number, g: number, b: number];
/** A shape's signed distance from a point, in pixels: negative inside. */
type Distance = (x: number, y: number) => number;

/** Discord shows emoji from a 128×128 image. */
const SIZE = 128;
const MID = SIZE / 2;
/** The brand's sour pink: steps the bot has reached. */
const PINK: Rgb = [0xff, 0x55, 0xff];
/** A neutral that reads on Discord's dark and light themes: steps still ahead. */
const GREY: Rgb = [0x8a, 0x84, 0x8a];
/** Destructive red: the owner ban. */
const RED: Rgb = [0xf0, 0x56, 0x53];
const DOT_RADIUS = 26;
const LINE_HALF_WIDTH = 8;
const MARK_RADIUS = 46;
const MARK_RING = 10;
const MARK_CENTRE = 22;

const disc =
  (radius: number): Distance =>
  (x, y) =>
    Math.hypot(x - MID, y - MID) - radius;
const ring =
  (outer: number, width: number): Distance =>
  (x, y) =>
    Math.abs(Math.hypot(x - MID, y - MID) - (outer - width / 2)) - width / 2;
/** A horizontal line across the whole image, so neighbouring emoji join up. */
const line: Distance = (_x, y) => Math.abs(y - MID) - LINE_HALF_WIDTH;
/** The current step: a ring around a dot, like a selected radio button. */
const mark = (colour: Rgb) => [
  { colour, distance: ring(MARK_RADIUS, MARK_RING) },
  { colour, distance: disc(MARK_CENTRE) },
];

/** Each emoji by its name in Discord, as shapes painted in order, with the characters the DM uses without it. */
export const STANDING_EMOJI = {
  standing_past: { shapes: [{ colour: PINK, distance: disc(DOT_RADIUS) }], fallback: '●' },
  standing_now: { shapes: mark(PINK), fallback: '◉' },
  standing_banned: { shapes: mark(RED), fallback: '◉' },
  standing_next: { shapes: [{ colour: GREY, distance: disc(DOT_RADIUS) }], fallback: '○' },
  standing_line_on: { shapes: [{ colour: PINK, distance: line }], fallback: '━━' },
  standing_line_off: { shapes: [{ colour: GREY, distance: line }], fallback: '──' },
} satisfies Record<string, { shapes: { colour: Rgb; distance: Distance }[]; fallback: string }>;

export type StandingEmojiName = keyof typeof STANDING_EMOJI;
/** How each standing emoji is written in a message: `<:name:id>`, or its fallback characters. */
export type StandingGlyphs = Record<StandingEmojiName, string>;

const NAMES = Object.keys(STANDING_EMOJI) as StandingEmojiName[];

/** One emoji as a PNG, transparent around its shapes, anti-aliased over one pixel. */
export async function standingEmojiPng(name: StandingEmojiName): Promise<Uint8Array<ArrayBuffer>> {
  const { shapes } = STANDING_EMOJI[name];
  const stride = 1 + SIZE * 4;
  const raw = new Uint8Array(stride * SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      // Source-over, shape by shape: premultiplied colour and alpha.
      let [r, g, b, a] = [0, 0, 0, 0];
      for (const { colour, distance } of shapes) {
        const cover = Math.min(1, Math.max(0, 0.5 - distance(x + 0.5, y + 0.5)));
        r = colour[0] * cover + r * (1 - cover);
        g = colour[1] * cover + g * (1 - cover);
        b = colour[2] * cover + b * (1 - cover);
        a = cover + a * (1 - cover);
      }
      if (a === 0) continue;
      const offset = y * stride + 1 + x * 4;
      raw.set([Math.round(r / a), Math.round(g / a), Math.round(b / a), Math.round(a * 255)], offset);
    }
  }
  return encodePng(SIZE, raw);
}

/** The application's emoji IDs by name. */
const uploaded = async (relay: Relay, appId: string) => new Map((await relay.discord.listApplicationEmojis(appId)).map((e) => [e.name, e.id]));

/** The standing emoji the application doesn't have yet; the Health page offers to upload them. */
export async function missingStandingEmoji(relay: Relay, appId: string): Promise<StandingEmojiName[]> {
  const have = await uploaded(relay, appId);
  return NAMES.filter((name) => !have.has(name));
}

/** Uploads the standing emoji the application doesn't have yet, by name, and answers the names it uploaded. */
export async function uploadStandingEmoji(relay: Relay, appId: string): Promise<StandingEmojiName[]> {
  const missing = await missingStandingEmoji(relay, appId);
  for (const name of missing) await relay.discord.createApplicationEmoji(appId, name, `data:image/png;base64,${b64(await standingEmojiPng(name))}`);
  return missing;
}

/**
 * How the DM writes each step: the uploaded emoji, or plain characters when any is missing or Discord can't say, so the DM
 * still sends and never mixes the two.
 */
export async function standingGlyphs(relay: Relay): Promise<StandingGlyphs> {
  const fallback = Object.fromEntries(NAMES.map((name) => [name, STANDING_EMOJI[name].fallback])) as StandingGlyphs;
  const appId = relay.config.discord.applicationId;
  if (!appId) return fallback;
  try {
    const have = await uploaded(relay, appId);
    if (NAMES.some((name) => !have.has(name))) return fallback;
    return Object.fromEntries(NAMES.map((name) => [name, `<:${name}:${have.get(name)}>`])) as StandingGlyphs;
  } catch (error) {
    relay.log.warn('standing.emoji_unavailable', { error });
    return fallback;
  }
}
