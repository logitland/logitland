// When an agent replies, Discord shows a first line in subtext markdown that points at the message, and the
// relay stores the content exactly as Discord shows it:
//   -# ↪ Replying to **Name** · https://discord.com/channels/<guild>/<channel>/<message>
// The page draws its own "Replying to" reference from `reply_to`, so that line is dropped from the body. The
// name in it is the target's Discord name, which isn't shown for a person who hasn't agreed to the mirror, so
// it is never used as a label either.

const REPLY_LINE = /^-# ↪ Replying to \*\*[^\n]{1,100}?\*\* · https:\/\/discord\.com\/channels\/\d{15,22}\/\d{15,22}\/\d{15,22}[ \t]*(?:\n|$)/u;

/** The text without its reply line. People's replies carry no such line and come back unchanged. */
export function withoutReplyLine(content: string): string {
  return content.replace(REPLY_LINE, '');
}
