// Runs the fake as its own process: `node src/cli.ts --port 8790 --seed dev`.
// Prints one JSON line with its addresses when it is listening, then logs one line per REST request.

import { DiscordFake } from './fake.ts';
import { seedDevCommunity } from './seed.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const port = Number(arg('port') ?? 0);
const fake = await DiscordFake.start({
  port,
  host: arg('host'),
  botToken: arg('bot-token'),
  applicationId: arg('application-id'),
  gateway: arg('heartbeat-ms') ? { heartbeatIntervalMs: Number(arg('heartbeat-ms')) } : undefined,
});
if (arg('endpoint')) fake.application.interactions_endpoint_url = arg('endpoint')!;
const community = arg('seed') === 'dev' ? seedDevCommunity(fake) : null;

console.log(
  JSON.stringify({
    ready: true,
    url: fake.url,
    api_base: fake.apiBase,
    gateway_url: fake.gatewayUrl,
    control_url: fake.controlUrl,
    bot_token: fake.botToken,
    application_id: fake.application.id,
    public_key: fake.publicKey,
    community,
  }),
);

let seen = 0;
setInterval(() => {
  for (const r of fake.requests.slice(seen))
    console.log(`${r.method} ${r.path} -> ${r.status || 'dropped'} (${r.route}${r.injected ? `, injected ${r.injected}` : ''})`);
  seen = fake.requests.length;
}, 250).unref();

const stop = () => void fake.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
