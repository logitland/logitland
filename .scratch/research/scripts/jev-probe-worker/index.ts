// Throwaway: times Jev through Cloudflare's AI binding against TypeSafe's own API, from inside Workers.
interface Env { AI: Ai; PROBE_KEY: string; TYPESAFE_API_KEY: string }

const POLICY = `Server rules: no harassment of individuals, no hate against protected groups, no sexual content involving minors, no graphic violence or threats, no spam or repeated promotion, no sharing of other people's personal data. Everything else is allowed. Judge only the "message" field; "channel" and "recent" are context.`
const JEV = {
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

const stats = (ms: number[]) => {
  const s = [...ms].sort((a, b) => a - b)
  const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))]
  return { n: s.length, min: s[0], median: at(0.5), p90: at(0.9), max: s.at(-1) }
}

async function time(run: () => Promise<unknown>) {
  const start = Date.now()
  try {
    await run()
    return { ms: Date.now() - start, ok: true }
  } catch (e) {
    return { ms: Date.now() - start, ok: false, error: String(e).slice(0, 200) }
  }
}

async function series(n: number, run: () => Promise<unknown>) {
  const out = []
  for (let i = 0; i < n; i++) out.push(await time(run))
  return out
}

async function probe(env: Env) {
  // Third-party models go through AI Gateway; the account's default gateway carries the prepaid credit.
  const viaCloudflare = () => env.AI.run('typesafe/jev' as never, JEV as never, { gateway: { id: 'default' } })
  const direct = async () => {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { authorization: `Bearer ${env.TYPESAFE_API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', ...JEV }),
    })
    if (!res.ok) throw new Error(`typesafe ${res.status}: ${(await res.text()).slice(0, 150)}`)
    return res.json()
  }
  await time(viaCloudflare) // warm-ups, excluded
  await time(direct)
  const cloudflareSeq = await series(10, viaCloudflare)
  const directSeq = await series(10, direct)
  const directPar = await Promise.all(Array.from({ length: 10 }, () => time(direct)))
  const sample = await direct().catch((e) => String(e))
  const summarise = (r: { ms: number; ok: boolean; error?: string }[]) => ({
    ...stats(r.filter((x) => x.ok).map((x) => x.ms)),
    errors: r.filter((x) => !x.ok).map((x) => x.error),
  })
  const trace = await (await fetch('https://cloudflare.com/cdn-cgi/trace')).text()
  return {
    colo: trace.match(/^colo=(.+)$/m)?.[1],
    jev_via_cloudflare_sequential: summarise(cloudflareSeq),
    jev_typesafe_direct_sequential: summarise(directSeq),
    jev_typesafe_direct_parallel_10: summarise(directPar),
    typesafe_sample: sample,
  }
}

export default {
  async fetch(req, env): Promise<Response> {
    if (new URL(req.url).searchParams.get('key') !== env.PROBE_KEY) return new Response('not found', { status: 404 })
    return Response.json(await probe(env))
  },
} satisfies ExportedHandler<Env>
