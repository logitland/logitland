// Times TypeSafe's own API from this machine. Reads the key from ~/.config/typesafe-api-key; never prints it.
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'

const key = readFileSync(`${homedir()}/.config/typesafe-api-key`, 'utf8').trim()
const src = readFileSync(new URL('./src/index.ts', import.meta.url), 'utf8')
const JEV = new Function(`${src.match(/const POLICY = [\s\S]*?\n}\n/)[0]}; return JEV`)()

const call = async () => {
  const t = performance.now()
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'jev-latest', ...JEV }),
  })
  const body = await res.text()
  return { ms: Math.round(performance.now() - t), status: res.status, body: res.ok ? undefined : body.slice(0, 200) }
}

await call() // warm-up over a kept-alive connection
const runs = []
for (let i = 0; i < 10; i++) runs.push(await call())
const ms = runs.filter((r) => r.status === 200).map((r) => r.ms).sort((a, b) => a - b)
console.log(JSON.stringify({ n: ms.length, min: ms[0], median: ms[Math.floor(ms.length / 2)], max: ms.at(-1), errors: runs.filter((r) => r.status !== 200) }))
