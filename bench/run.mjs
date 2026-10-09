// Meme-picking benchmark: does the system pick the template each request was written for?
//   node bench/run.mjs <experiment> <train|test|dev> [limit]
// Metrics: shortlist recall (target among the templates the writer is shown), hit@1 and hit@3
// (target among the first one or three templates picked). Model calls go through `claude -p`
// with nothing loaded but a system prompt, and are cached in bench/cache by their inputs.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as lib from '../hooks/lib.js'
import { EXPERIMENTS } from './experiments.mjs'

const here = (p) => new URL(p, import.meta.url)
const [name, split = 'dev', limitArg] = process.argv.slice(2)
const exp = EXPERIMENTS[name]
if (!exp) throw new Error(`no experiment ${name}; have ${Object.keys(EXPERIMENTS).join(', ')}`)

// The catalog as the mod sees it with the Meme Factory server.
const catalog = JSON.parse(readFileSync(here('./catalog.json')))
const extra = JSON.parse(existsSync(here('./enrich.json')) ? readFileSync(here('./enrich.json')) : '{}')
lib.addTemplates(catalog.filter((t) => !lib.TEMPLATE_BY_ID.has(t.id)))
for (const t of lib.TEMPLATE_BY_ID.values()) if (extra[t.id]) Object.assign(t, extra[t.id])
lib.configureSearch({ ...BASE_SEARCH(), ...(exp.search ?? {}) })
function BASE_SEARCH() {
  return { fields: { name: 3, aliases: 3, shape: 2, core: 1, slots: 1, visual: 0 }, popWeight: 0.25, unmatched: 0.12, diversity: 0.06, k1: 1.2, b: 0.75 }
}

const bench = JSON.parse(readFileSync(here('./bench.json')))
let items = bench.filter((q) => (split === 'dev' ? q.split === 'train' && q.dev : q.split === split))
if (limitArg) items = items.slice(0, Number(limitArg))

const CONC = Number(process.env.CONC || 12)
let active = 0
const queue = []
const slot = () => (active < CONC ? (active++, Promise.resolve()) : new Promise((r) => queue.push(r)))
const free = () => (queue.length ? queue.shift()() : active--)
let calls = 0
let cached = 0

export async function llm(model, system, prompt) {
  const key = createHash('sha256').update(`${model}\n${system}\n${prompt}`).digest('hex')
  const file = here(`./cache/${key}.json`)
  if (existsSync(file)) return (cached++, JSON.parse(readFileSync(file)).text)
  await slot()
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const out = await new Promise((resolve) => {
        const p = spawn('claude', ['-p', '--model', model, '--system-prompt', system, '--tools', '', '--strict-mcp-config', '--setting-sources', '', '--disable-slash-commands', '--output-format', 'json', prompt], { stdio: ['ignore', 'pipe', 'pipe'] })
        let s = ''
        p.stdout.on('data', (d) => (s += d))
        p.on('close', () => resolve(s))
      })
      try {
        const text = JSON.parse(out).result
        if (typeof text === 'string' && text) {
          calls++
          writeFileSync(file, JSON.stringify({ model, text }))
          return text
        }
      } catch {}
    }
    return ''
  } finally {
    free()
  }
}

// Duplicate templates (the same meme under two ids) count as the same answer.
const groups = JSON.parse(existsSync(here('./dupes.json')) ? readFileSync(here('./dupes.json')) : '[]')
const groupOf = new Map()
for (const g of groups) for (const id of g) groupOf.set(id, g)
const same = (a, b) => a === b || (groupOf.get(a)?.includes(b) ?? false)
const distinct = (ids) => [...new Set(ids.filter((id) => lib.TEMPLATE_BY_ID.has(id)))]

async function one(q) {
  const query = exp.expand ? await exp.expand(q.request, llm, lib) : q.request
  const shortlist = exp.shortlistAsync ? await exp.shortlistAsync(query, lib, q.request, llm) : exp.shortlist ? exp.shortlist(query, lib, q.request) : lib.shortlistFor(query)
  const picks = exp.pick ? distinct(await exp.pick(q.request, shortlist, llm, lib)) : shortlist.slice(0, 3)
  return { qid: q.qid, target: q.target, request: q.request, style: q.style, inShortlist: shortlist.some((id) => same(id, q.target)), rank: shortlist.findIndex((id) => same(id, q.target)), picks: picks.slice(0, 3), hit1: picks.length > 0 && same(picks[0], q.target), hit3: picks.slice(0, 3).some((id) => same(id, q.target)) }
}

const started = Date.now()
const results = await Promise.all(items.map(one))
const pct = (f, list = results) => (list.length ? Math.round((1000 * list.filter(f).length) / list.length) / 10 : 0)
const summary = { experiment: name, split, n: results.length, shortlist: pct((r) => r.inShortlist), hit1: pct((r) => r.hit1), hit3: pct((r) => r.hit3), byStyle: {}, calls, cached, minutes: Math.round((Date.now() - started) / 6000) / 10 }
for (const st of ['situation', 'visual', 'named']) {
  const l = results.filter((r) => r.style === st)
  summary.byStyle[st] = { n: l.length, shortlist: pct((r) => r.inShortlist, l), hit1: pct((r) => r.hit1, l), hit3: pct((r) => r.hit3, l) }
}
mkdirSync(here('./results'), { recursive: true })
writeFileSync(here(`./results/${name}-${split}.json`), JSON.stringify({ summary, results }, null, 1))
console.log(JSON.stringify(summary))
