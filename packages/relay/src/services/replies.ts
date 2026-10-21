// Replies through webhooks (#10). Discord's webhooks can't make native replies, so the relay puts a line above an agent's
// reply, which Discord renders as a small quote:
//
//   -# > replying to [<@348589994438295553>: "waow"](https://discord.com/channels/<guild>/<channel>/<message>)
//
// The target is a mention for a person or a bot (posts are sent with mentions disabled, so nobody is pinged) and the
// agent's name for an agent; the quote is the original's first 10 words. Coming back through the Gateway the line is
// taken off again and becomes `reply_to`, so agents see one reply model whichever way a reply was made.

const QUOTE_WORDS = 10;
const OPEN = '-# > replying to [';
/** The link at the end of the line; the quote can't contain it, since brackets are taken out of quotes. */
const LINE = /^-# > replying to \[[^\n]*\]\(https:\/\/discord\.com\/channels\/\d{17,20}\/\d{17,20}\/(\d{17,20})\)$/;

export interface ReplyTarget {
  author_kind: 'agent' | 'human' | 'webhook' | 'bot';
  discord_user_id: string | null;
  display_name: string;
  content: string | null;
}

/** Brackets, parentheses and quotes would end the link text early; mentions and markdown would render. */
const plain = (text: string) =>
  text
    .replace(/<[@#][!&]?\d+>/g, '')
    .replace(/[[\]()"`*_~|<>\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** The first 10 words, with an ellipsis when there were more. Empty when nothing is left to quote. */
export function quoteOf(content: string | null): string {
  const words = plain(content ?? '')
    .split(' ')
    .filter(Boolean);
  if (!words.length) return '';
  return words.slice(0, QUOTE_WORDS).join(' ') + (words.length > QUOTE_WORDS ? '…' : '');
}

/**
 * The line above a reply. `safe` says whether a quote may be shown (the caller runs the message rules over it), so a
 * quote the relay wouldn't post as the agent's own words is left out.
 */
export function renderReplyLine(target: ReplyTarget, link: string, safe: (quote: string) => boolean): string {
  const who = target.discord_user_id && target.author_kind !== 'agent' ? `<@${target.discord_user_id}>` : plain(target.display_name) || 'a message';
  const quote = quoteOf(target.content);
  return `${OPEN}${who}${quote && safe(quote) ? `: "${quote}"` : ''}](${link})`;
}

/** Takes a reply line off the top of a message: the text under it, and the message it points at. */
export function parseReplyLine(content: string): { replyTo: string; content: string } | null {
  if (!content.startsWith(OPEN)) return null;
  const end = content.indexOf('\n');
  const match = LINE.exec(end === -1 ? content : content.slice(0, end));
  if (!match) return null;
  return { replyTo: match[1]!, content: end === -1 ? '' : content.slice(end + 1) };
}

/** SQL: a stored reply line with its target and quote replaced by "a person", for when that person withdraws. */
export const unnamedReplyLine = (col: string) => `'${OPEN}a person](' || substr(${col}, instr(${col}, '](https://discord.com/channels/') + 2)`;
/** SQL: whether a stored value is a reply line. */
export const isReplyLine = (col: string) => `instr(${col}, '${OPEN}') = 1 AND instr(${col}, '](https://discord.com/channels/') > 0`;
