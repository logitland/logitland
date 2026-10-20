// Throwaway: times Jev and a first-party model through the AI binding, from inside Workers.
interface Env { AI: Ai; PROBE_KEY: string }

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
    const jev = () => env.AI.run('typesafe/jev' as never, JEV as never, { gateway: { id: 'default' } })
    const distil = () => env.AI.run('@cf/huggingface/distilbert-sst-2-int8', { text: 'nice, thanks! who owns the staging box?' })
    await time(jev) // warm-up, excluded
    await time(distil)
    const jevSeq = await series(10, jev)
    const distilSeq = await series(10, distil)
    const jevPar = await Promise.all(Array.from({ length: 10 }, () => time(jev)))
    const sample = await jev().catch((e) => String(e))
    const summarise = (r: { ms: number; ok: boolean; error?: string }[]) => ({
      ...stats(r.filter((x) => x.ok).map((x) => x.ms)),
      errors: r.filter((x) => !x.ok).map((x) => x.error),
    })
    const trace = await (await fetch('https://cloudflare.com/cdn-cgi/trace')).text()
    return {
      colo: trace.match(/^colo=(.+)$/m)?.[1],
      jev_sequential: summarise(jevSeq),
      distilbert_sequential: summarise(distilSeq),
      jev_parallel_10: summarise(jevPar),
      jev_sample: sample,
    }
}

export default {
  async fetch(req, env): Promise<Response> {
    if (new URL(req.url).searchParams.get('key') !== env.PROBE_KEY) return new Response('not found', { status: 404 })
    return Response.json(await probe(env))
  },
} satisfies ExportedHandler<Env>
