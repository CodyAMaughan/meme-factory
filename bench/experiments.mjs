// The meme-picking experiments. Each one sets how a request becomes a query (expand), which
// templates the writer is shown (shortlist), and how the final three are picked (pick).
const parse = (lib, text) => { try { return lib.parseJson(text) ?? {} } catch { return {} } }

// The mod today: Haiku turns the request into search words.
async function expandCurrent(request, llm, lib) {
  const q = parse(lib, await llm('haiku', 'You match jokes to meme templates. Reply with JSON only.', lib.searchPrompt(request)))
  const extra = [q?.shape, ...(Array.isArray(q?.words) ? q.words : [])].filter((w) => typeof w === 'string').join(' ')
  return `${request} ${extra}`
}

// More template names: names and aliases are what the index weighs most.
const NAMES_PROMPT = (request) => `Meme request: ${request}

Which popular meme templates (the ones on Imgflip and Know Your Meme) would make this joke best? Reply {"templates":[...],"words":[...]}:
- templates: the 8 best-fitting templates, best first, by the names people search for them ("Drake Hotline Bling", "Surprised Pikachu", "Two Buttons")
- words: 10 words for what those pictures show and the feeling (sweating, smug, shocked, pointing, waiting...)`
async function expandNames(request, llm, lib) {
  const q = parse(lib, await llm('haiku', 'You know every popular meme template by name. Reply with JSON only.', NAMES_PROMPT(request)))
  const names = Array.isArray(q?.templates) ? q.templates.filter((w) => typeof w === 'string') : []
  const words = Array.isArray(q?.words) ? q.words.filter((w) => typeof w === 'string') : []
  return `${request} ${names.join(' ')} ${names.join(' ')} ${words.join(' ')}`
}

// The writer picks while writing, as the mod does (model as given).
const writerPick = (model) => async (request, shortlist, llm, lib) => {
  const [rules, task] = lib.writerPrompt({ request, shortlist })
  const out = parse(lib, await llm(model, lib.WRITER_SYSTEM, `${rules.text}\n\n${task.text}`))
  return (Array.isArray(out?.candidates) ? out.candidates : []).map((c) => c?.template_id)
}

// A dedicated pick before writing: full cards, choose the three best.
const PICK_PROMPT = (request, cards) => `Meme request: ${request}

Candidate templates (id | name | shape | what it means | box roles):
${cards}

Which three templates fit this request best? Judge the joke's structure and what the person is describing (or naming), not just topic words. Reply {"picks":["id","id","id"]}, best first.`
const cardLine = (t) => [t.id, t.name, t.shape, t.core, (t.slots ?? []).join(' / ')].join(' | ')
const pickerPick = (model) => async (request, shortlist, llm, lib) => {
  const cards = shortlist.map((id) => cardLine(lib.TEMPLATE_BY_ID.get(id))).join('\n')
  const out = parse(lib, await llm(model, 'You choose the right meme template for a joke. Reply with JSON only.', PICK_PROMPT(request, cards)))
  return Array.isArray(out?.picks) ? out.picks : []
}

// Two-stage retrieval: a wide search, then Haiku reranks the top 100 by name and idea.
const RERANK_PROMPT = (request, lines) => `Meme request: ${request}

Templates (id | name | what it means):
${lines}

Which 20 of these could make this joke best? Reply {"ids":[...]}, best first.`
const rerankShortlist = (wide = 100, keep = 20) => async (query, lib, request, llm) => {
  const ids = lib.rankTemplates(query, wide)
  const lines = ids.map((id) => { const t = lib.TEMPLATE_BY_ID.get(id); return `${t.id} | ${t.name} | ${t.core}` }).join('\n')
  const out = parse(lib, await llm('haiku', 'You match jokes to meme templates. Reply with JSON only.', RERANK_PROMPT(request, lines)))
  const top = (Array.isArray(out?.ids) ? out.ids : []).filter((id) => ids.includes(id)).slice(0, keep)
  return [...new Set([...top, ...ids])].slice(0, 40)
}


// HyDE (hypothetical document): Haiku writes the card of the ideal template, in the catalog's own
// words, and that card is the query. The standard trick when queries and documents are worded
// differently (a situation vs a description of a meme).
const HYDE_PROMPT = (request) => `Meme request: ${request}

Describe the ideal meme template for this joke as a catalog card. Reply {"name":"...","shape":"...","core":"...","slots":["..."],"picture":"..."}:
- name: the popular template's usual name, if you know one that fits
- shape: reaction, binary-choice, labeling, escalation, before-after, dialogue, exaggeration, comparison, irony, warning, rejection, approval, self-own or plan-backfires
- core: one sentence, what that meme means and when people use it
- slots: one short role per text box
- picture: 10 to 20 words on what the picture shows`
async function expandHyde(request, llm, lib) {
  const q = parse(lib, await llm('haiku', 'You know every popular meme template. Reply with JSON only.', HYDE_PROMPT(request)))
  const parts = [q?.name, q?.name, q?.shape, q?.core, ...(Array.isArray(q?.slots) ? q.slots : []), q?.picture].filter((w) => typeof w === 'string')
  return `${request} ${parts.join(' ')}`
}

// Generative retrieval: Haiku reads every template's name and shape (the same long system prompt
// each time, so it's cached) and names the 15 that fit; the search fills the rest of the shortlist.
let CATALOG_SYSTEM = null
const catalogShortlist = async (query, lib, request, llm) => {
  CATALOG_SYSTEM ??= `You match jokes to meme templates. Reply with JSON only.\n\nTemplates (id | name | shape):\n${[...lib.TEMPLATE_BY_ID.values()].map((t) => `${t.id} | ${t.name} | ${t.shape}`).join('\n')}`
  const out = parse(lib, await llm('haiku', CATALOG_SYSTEM, `Meme request: ${request}\n\nWhich 15 templates above could make this joke best? Reply {"ids":[...]}, best first.`))
  const named = (Array.isArray(out?.ids) ? out.ids : []).filter((id) => lib.TEMPLATE_BY_ID.has(id)).slice(0, 15)
  return [...new Set([...named, ...lib.shortlistFor(query)])].slice(0, 40)
}

const V = { fields: { visual: 1 } } // picture descriptions in the index (bench/enrich.json)

// Rerank with the picture too, from a wider pool.
const RERANK2_PROMPT = (request, lines) => `Meme request: ${request}

Templates (id | name | what it means | what the picture shows):
${lines}

Which 25 of these could make this joke best? Judge the joke's structure and what the person describes or names. Reply {"ids":[...]}, best first.`
const rerankVisual = (wide = 200, keep = 25, model = 'haiku') => async (query, lib, request, llm) => {
  const ids = lib.rankTemplates(query, wide)
  const lines = ids.map((id) => { const t = lib.TEMPLATE_BY_ID.get(id); return `${t.id} | ${t.name} | ${t.core} | ${t.visual ?? ''}` }).join('\n')
  const out = parse(lib, await llm(model, 'You match jokes to meme templates. Reply with JSON only.', RERANK2_PROMPT(request, lines)))
  const top = (Array.isArray(out?.ids) ? out.ids : []).filter((id) => ids.includes(id)).slice(0, keep)
  return [...new Set([...top, ...ids])].slice(0, 40)
}

export const EXPERIMENTS = {
  // Retrieval only (no model at all): the search ranks, its top three are the picks.
  'e0-lexical': {},
  'e0-visual1': { search: V },
  'e0-visual2': { search: { fields: { visual: 2 } } },
  'e0-visual3': { search: { fields: { visual: 3 } } },
  // The mod today (0.11.0), with Sonnet standing in for Opus as the writer.
  'e1-current': { expand: expandCurrent, pick: writerPick('sonnet') },
  'e1-current-opus': { expand: expandCurrent, pick: writerPick('opus') },
  // + picture descriptions in the cards.
  'e2-visual': { expand: expandCurrent, search: V, pick: writerPick('sonnet') },
  // + popularity: none, or twice as much.
  'e3-pop0': { expand: expandCurrent, search: { ...V, popWeight: 0, unmatched: 0 }, pick: writerPick('sonnet') },
  'e3-pop50': { expand: expandCurrent, search: { ...V, popWeight: 0.5, unmatched: 0.2 }, pick: writerPick('sonnet') },
  // + query rewriting that names templates.
  'e4-names': { expand: expandNames, search: V, pick: writerPick('sonnet') },
  // + a wider shortlist (60 matches plus 10 staples).
  'e5-wide': { expand: expandCurrent, search: V, shortlist: (q, lib) => lib.shortlistFor(q, { matches: 60, popular: 10 }), pick: writerPick('sonnet') },
  // + a dedicated pick from full cards, before the writer.
  'e6-picker': { expand: expandCurrent, search: V, pick: pickerPick('sonnet') },
  // + two-stage retrieval: Haiku reranks the top 100.
  'e7-rerank': { expand: expandCurrent, search: V, shortlistAsync: rerankShortlist(100, 20), pick: writerPick('sonnet') },
  // HyDE query rewriting.
  'e9-hyde': { expand: expandHyde, search: V, pick: writerPick('sonnet') },
  // Generative retrieval over the whole catalog's names.
  'e10-catalog': { expand: expandCurrent, search: V, shortlistAsync: catalogShortlist, pick: writerPick('sonnet') },
  // Rerank variants: picture descriptions, a 200-wide pool, and Sonnet as the reranker.
  'e11-rerank-visual': { expand: expandCurrent, search: V, shortlistAsync: rerankVisual(100, 25), pick: writerPick('sonnet') },
  'e12-rerank-200': { expand: expandCurrent, search: V, shortlistAsync: rerankVisual(200, 25), pick: writerPick('sonnet') },
  'e13-rerank-sonnet': { expand: expandCurrent, search: V, shortlistAsync: rerankVisual(200, 25, 'sonnet'), pick: writerPick('sonnet') },
  // Everything that might help together.
  'e8-combined': { expand: expandHyde, search: V, shortlistAsync: async (q, lib, r, llm) => { const a = await catalogShortlist(q, lib, r, llm); const b = await rerankVisual(200, 25)(q, lib, r, llm); return [...new Set([...b.slice(0, 25), ...a.slice(0, 15), ...b])].slice(0, 40) }, pick: writerPick('sonnet') },
  'e14-hyde-rerank': { expand: expandHyde, search: V, shortlistAsync: rerankVisual(200, 25), pick: writerPick('sonnet') },
}
