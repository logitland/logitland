// Splits Jev's latency into network, gateway and model time, all over ONE keep-alive connection.
// Usage: node jev-latency-breakdown.mjs <ping|distil|jev-min|jev-full> [n] [outfile]
//   ping       n authenticated GET /accounts/<id> (no model call): network + API edge baseline
//   distil     n calls to @cf/huggingface/distilbert-sst-2-int8 on /ai/run: gateway/route cost without Jev
//   jev-min    n Jev calls with a ~100-token request
//   jev-full   n Jev calls with the 611-token request from jev-measure.mjs
//   mix        n rounds of ping, distil, jev-min, jev-full back to back (cancels drift between modes)
// Every record keeps ttfb (time to first response byte) and total wall time, whether the socket was reused,
// and any timing-like response headers. Token: read from wrangler's OAuth config, never printed.
// Budget: model calls (not ping) are capped at CALL_BUDGET across invocations.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'
import https from 'node:https'

const ACCOUNT = 'b2b315609fd561e6313488045ac4d8a2'
const HOST = 'api.cloudflare.com'
const BASE = `/client/v4/accounts/${ACCOUNT}`
const CALL_BUDGET = 60
const COUNTER = '/tmp/jev-breakdown-count'

const toml = readFileSync(`${homedir()}/.config/.wrangler/config/default.toml`, 'utf8')
const token = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1]
if (!token) throw new Error('no oauth_token in wrangler config')

const agent = new https.Agent({ keepAlive: true, maxSockets: 1 })

const POLICY = `Server rules: no harassment of individuals, no hate against protected groups, no sexual content involving minors, no graphic violence or threats, no spam or repeated promotion, no sharing of other people's personal data. Everything else is allowed. Judge only the "message" field; "channel" and "recent" are context.`

const FULL = {
  state: {
    channel: '#agent-lounge',
    recent: [
      { author: 'vesper', text: 'anyone tried the new retry policy on the relay yet?' },
      { author: 'ink', text: 'yeah, 3 retries with backoff, seems to hold up fine' },
    ],
    message: { author: 'drift', text: 'nice, thanks! btw who owns the staging box, I want to ping them' },
  },
  questions: {
    verdict: {
      type: 'choice',
      instructions: POLICY,
      criteria: {
        allow: 'The message follows the rules.',
        unsure: 'A human should look at it; the message may break a rule.',
        harassment: 'Targets an individual with abuse or intimidation.',
        hate: 'Attacks a protected group.',
        'sexual content involving minors': 'Any sexual content involving minors.',
        violence: 'Graphic violence or threats.',
        spam: 'Repeated or unsolicited promotion.',
        'personal data': "Shares someone's private personal information.",
      },
    },
  },
}

const MIN = {
  state: 'nice, thanks! btw who owns the staging box?',
  questions: {
    verdict: {
      type: 'choice',
      instructions: 'Is the state a harassing message?',
      criteria: { yes: 'It is harassing.', no: 'It is not harassing.', unsure: 'Cannot tell.' },
    },
  },
}

const DISTIL = { text: 'nice, thanks! btw who owns the staging box?' }

const MODES = {
  ping: { method: 'GET', path: BASE },
  distil: { method: 'POST', path: `${BASE}/ai/run`, body: { model: '@cf/huggingface/distilbert-sst-2-int8', input: DISTIL }, model: true },
  'jev-min': { method: 'POST', path: `${BASE}/ai/run`, body: { model: 'typesafe/jev', input: MIN }, model: true },
  'jev-full': { method: 'POST', path: `${BASE}/ai/run`, body: { model: 'typesafe/jev', input: FULL }, model: true },
}

function bump(n) {
  const used = existsSync(COUNTER) ? Number(readFileSync(COUNTER, 'utf8')) : 0
  if (used + n > CALL_BUDGET) throw new Error(`budget: ${used} used, ${n} requested, cap ${CALL_BUDGET}`)
  writeFileSync(COUNTER, String(used + n))
}

const TIMING_HEADER = /timing|^cf-aig|^cf-ray|^cf-cache|^age$|^date$|ratelimit|retry/i

function request({ method, path, body }) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : undefined
    const start = performance.now()
    let ttfb
    const req = https.request(
      {
        host: HOST,
        method,
        path,
        agent,
        headers: {
          authorization: `Bearer ${token}`,
          ...(payload && { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) }),
        },
      },
      (res) => {
        ttfb = Math.round((performance.now() - start) * 10) / 10
        const chunks = []
        res.on('data', (c) => chunks.push(c))
        res.on('end', () => {
          const total = Math.round((performance.now() - start) * 10) / 10
          const text = Buffer.concat(chunks).toString()
          let json
          try { json = JSON.parse(text) } catch { json = text }
          resolve({
            at: new Date().toISOString(),
            status: res.statusCode,
            ttfb,
            total,
            reusedSocket: req.reusedSocket,
            headers: Object.fromEntries(Object.entries(res.headers).filter(([k]) => TIMING_HEADER.test(k))),
            allHeaderNames: Object.keys(res.headers),
            body: method === 'GET' ? undefined : json,
          })
        })
      },
    )
    req.on('error', reject)
    if (payload) req.write(payload)
    req.end()
  })
}

const [mode, nArg, out] = process.argv.slice(2)
const spec = mode === "mix" ? null : MODES[mode]
if (mode !== "mix" && !spec) throw new Error(`mode must be one of ${Object.keys(MODES).join(', ')}`)
const n = Number(nArg) || 10
const file = out ?? `/tmp/jev-breakdown-${mode}.jsonl`
const sequence = mode === "mix" ? Object.keys(MODES) : [mode]
const modelCalls = sequence.filter((m) => MODES[m].model).length * (n + 1)
if (modelCalls) bump(modelCalls)
// Round 0 is a warm-up that opens the connection; it is recorded with warmup:true and left out of the stats.
for (let i = 0; i <= n; i++) {
  for (const m of sequence) {
    const r = await request(MODES[m])
    appendFileSync(file, JSON.stringify({ mode: m, warmup: i === 0, ...r }) + "\n")
  }
}
agent.destroy()
console.log(`${n} calls (+1 warm-up) recorded to ${file}`)
