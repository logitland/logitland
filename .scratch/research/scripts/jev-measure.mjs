// Measures typesafe/jev on Workers AI: latency, rate limit, error shapes, score question.
// Usage: node jev-measure.mjs <probe|latency|burst> [n] [outfile]
//   probe          1 call, prints the full response and headers
//   latency [n]    n sequential calls (every 4th also asks the score question)
//   burst [n]      n parallel calls
// Token: read from wrangler's OAuth config, sent only as the bearer header, never printed.
// Budget: a counter file caps total calls at CALL_BUDGET across invocations.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs'
import { homedir } from 'node:os'

const ACCOUNT = 'b2b315609fd561e6313488045ac4d8a2'
const MODEL = 'typesafe/jev'
const URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/ai/run`
const CALL_BUDGET = 80
const COUNTER = '/tmp/jev-call-count'

const toml = readFileSync(`${homedir()}/.config/.wrangler/config/default.toml`, 'utf8')
const token = toml.match(/^oauth_token\s*=\s*"([^"]+)"/m)?.[1]
if (!token) throw new Error('no oauth_token in wrangler config')

const POLICY = `Server rules: no harassment of individuals, no hate against protected groups, no sexual content involving minors, no graphic violence or threats, no spam or repeated promotion, no sharing of other people's personal data. Everything else is allowed. Judge only the "message" field; "channel" and "recent" are context.`

const request = (withScore) => ({
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
    ...(withScore && {
      sentiment: {
        type: 'score',
        instructions: 'How positive or negative is the tone of "message"?',
        criteria: ['very negative', 'negative', 'neutral', 'positive', 'very positive'],
      },
    }),
  },
})

function bump(n) {
  const used = existsSync(COUNTER) ? Number(readFileSync(COUNTER, 'utf8')) : 0
  if (used + n > CALL_BUDGET) throw new Error(`budget: ${used} used, ${n} requested, cap ${CALL_BUDGET}`)
  writeFileSync(COUNTER, String(used + n))
}

async function call(withScore) {
  const start = performance.now()
  const res = await fetch(URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, input: request(withScore) }),
  })
  const text = await res.text()
  const ms = Math.round(performance.now() - start)
  let body
  try { body = JSON.parse(text) } catch { body = text }
  return { at: new Date().toISOString(), status: res.status, ms, withScore, headers: Object.fromEntries(res.headers), body }
}

const [mode, nArg, out] = process.argv.slice(2)
const n = Number(nArg) || (mode === 'probe' ? 1 : 20)
const file = out ?? `/tmp/jev-${mode}.jsonl`
const record = (r) => appendFileSync(file, JSON.stringify(r) + '\n')

bump(n)
if (mode === 'burst') {
  const results = await Promise.all(Array.from({ length: n }, () => call(false)))
  results.forEach(record)
} else {
  for (let i = 0; i < n; i++) record(await call(mode === 'latency' && i % 4 === 3))
}
console.log(`${n} calls recorded to ${file}`)
