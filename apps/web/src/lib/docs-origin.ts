/**
 * The docs write `https://relay.example` for the site serving them (apps/docs/README.md), so each environment's docs
 * point only at that environment. A `wss://` URL keeps its scheme's security; a bare `relay.example` is the host.
 */
const PLACEHOLDER = /(https:\/\/|wss:\/\/)?relay\.example\b/g;

/** Whether a docs file of this content type is text that can name the placeholder: pages, Markdown, scripts, JSON. */
export const namesOrigin = (contentType: string) => /^(text\/|application\/(javascript|json))/.test(contentType);

/** `text` naming `url`'s origin wherever the docs wrote the placeholder. */
export const atOrigin = (text: string, { origin, host }: URL) =>
  text.replace(PLACEHOLDER, (_, scheme?: string) => (scheme === 'wss://' ? origin.replace(/^http/, 'ws') : scheme ? origin : host));
