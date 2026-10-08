// Pure helpers: no mods API calls here, so register.js keeps every `$` call
// where `claude plugin validate` can see it.
import { TEMPLATES } from './templates.js'

export const TEMPLATE_BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]))
export const DRAFTS = 3

// ---------- memegen.link URLs ----------

// https://memegen.link/#special-characters
export function encodeLine(text) {
  const s = String(text ?? '').trim()
  if (!s) return '_'
  const escaped = s
    .replace(/_/g, '__')
    .replace(/-/g, '--')
    .replace(/ /g, '_')
    .replace(/\?/g, '~q')
    .replace(/&/g, '~a')
    .replace(/%/g, '~p')
    .replace(/#/g, '~h')
    .replace(/\//g, '~s')
    .replace(/\\/g, '~b')
    .replace(/</g, '~l')
    .replace(/>/g, '~g')
    .replace(/"/g, "''")
    .replace(/\n/g, '~n')
  return encodeURIComponent(escaped).replace(/%7E/gi, '~').replace(/%2C/gi, ',').replace(/'/g, '%27')
}

export function memeUrl(templateId, lines, ext = 'png') {
  return `https://api.memegen.link/images/${templateId}/${lines.map(encodeLine).join('/')}.${ext}`
}

export function makeDraft(templateId, lines, score) {
  const t = TEMPLATE_BY_ID.get(templateId)
  if (!t) return null
  const fixed = (Array.isArray(lines) ? lines : []).slice(0, t.lines).map((l) => String(l ?? ''))
  while (fixed.length < t.lines) fixed.push('')
  if (!fixed.some((l) => l.trim())) return null
  return {
    id: `${t.id}-${hash(fixed.join('|')).toString(36)}`,
    template_id: t.id,
    template_name: t.name,
    lines: fixed,
    url: memeUrl(t.id, fixed),
    score: typeof score === 'number' ? score : null,
  }
}

// ---------- Prompts ----------

const CATALOG = TEMPLATES.map((t) => `${t.id}|${t.name}|${t.lines}`).join('\n')

export const WRITER_SYSTEM = `You are the writer at a meme factory. You know classic image-macro meme templates and their joke structures well.
Reply with JSON only, no prose and no code fences.`

export function writerPrompt({ request, context, feedback, previous, templateIds }) {
  const pick = templateIds?.length
    ? `Use exactly these templates: ${templateIds
        .map((id) => {
          const t = TEMPLATE_BY_ID.get(id)
          return `${id} (${t.name}, ${t.lines} lines, example ${JSON.stringify(t.example)})`
        })
        .join('; ')}.`
    : `Pick the 3 templates from the catalog whose joke structure best fits, then write for them.
Catalog (id|name|text lines):
${CATALOG}`
  return `Meme request: ${request}
${context ? `Context from the user's work: ${context}\n` : ''}${previous ? `Previous draft: ${previous.template_name} ${JSON.stringify(previous.lines)}\n` : ''}${feedback?.length ? `User feedback so far (most recent last): ${feedback.map((f) => JSON.stringify(f)).join(', ')}\n` : ''}
${pick}
Write 2 candidates per template, each with a different comedic angle. Give each template exactly its number of text lines, in order ("" for an intentionally blank line). Keep lines short and punchy, under 60 characters.
Return: {"candidates":[{"template_id":"...","lines":["..."]}]}`
}

export const JUDGE_SYSTEM = `You are the quality judge at a meme factory: a tough, funny editor.
Reply with JSON only, no prose and no code fences.`

export function judgePrompt(request, drafts) {
  const list = drafts
    .map((d, i) => `${i}: ${d.template_name} (usually ${JSON.stringify(TEMPLATE_BY_ID.get(d.template_id).example)}) -> ${JSON.stringify(d.lines)}`)
    .join('\n')
  return `Meme request: ${request}
Candidates:
${list}
Score each 0-10 for how funny and shareable it is, how well it delivers the request, and whether it uses the template's joke structure correctly. Be harsh: generic or confusing captions score low.
Return: {"scores":[{"i":0,"score":7}]}`
}

// Models sometimes wrap JSON in fences or add a sentence; take the outermost object.
export function parseJson(text) {
  const s = String(text ?? '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('The model did not return JSON')
  return JSON.parse(s.slice(start, end + 1))
}

export function draftsFromWriter(text) {
  const { candidates } = parseJson(text)
  const out = []
  for (const c of Array.isArray(candidates) ? candidates : []) {
    const d = makeDraft(c?.template_id, c?.lines)
    if (d && !out.some((o) => o.id === d.id)) out.push(d)
  }
  if (!out.length) throw new Error('No usable captions came back')
  return out
}

export function applyScores(drafts, text) {
  let scores = []
  try {
    scores = parseJson(text).scores ?? []
  } catch {
    return drafts
  }
  return drafts.map((d, i) => {
    const s = scores.find((x) => Number(x?.i) === i)
    return { ...d, score: s ? Number(s.score) : d.score }
  })
}

// Best first, preferring distinct templates before repeating one.
export function topDrafts(drafts, n = DRAFTS) {
  const sorted = [...drafts].sort((a, b) => (b.score ?? -1) - (a.score ?? -1))
  const out = []
  for (const d of sorted) if (out.length < n && !out.some((o) => o.template_id === d.template_id)) out.push(d)
  for (const d of sorted) if (out.length < n && !out.includes(d)) out.push(d)
  return out
}

// ---------- Jev (optional): bounded decisions at $0.042/M input tokens ----------

export const JEV_URL = 'https://api.typesafe.ai/v1/systemone'

export function jevPickBody(request) {
  return JSON.stringify({
    model: 'jev-latest',
    state: { meme_request: request },
    questions: {
      template: {
        type: 'choice',
        instructions: "Which classic meme template's joke structure best fits this request?",
        criteria: Object.fromEntries(
          TEMPLATES.map((t) => [t.id, `${t.name} (${t.lines} lines)${t.example.length ? `, e.g. "${t.example.filter(Boolean).join(' / ')}"` : ''}`]),
        ),
      },
    },
  })
}

export function jevPickResult(text, k = DRAFTS) {
  const probs = JSON.parse(text)?.answers?.template?.probabilities ?? {}
  return Object.entries(probs)
    .filter(([id]) => TEMPLATE_BY_ID.has(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => id)
}

const HUMOR = ['not funny', 'mildly amusing', 'funny', 'very funny', 'hilarious, very shareable']

export function jevJudgeBody(request, drafts) {
  const questions = {}
  drafts.forEach((_, i) => {
    questions[`c${i}`] = { type: 'score', instructions: `How funny and on-request is candidate c${i}?`, criteria: HUMOR }
  })
  return JSON.stringify({
    model: 'jev-latest',
    state: {
      meme_request: request,
      candidates: Object.fromEntries(drafts.map((d, i) => [`c${i}`, { template: d.template_name, lines: d.lines }])),
    },
    questions,
  })
}

export function jevJudgeResult(text, drafts) {
  const answers = JSON.parse(text)?.answers ?? {}
  return drafts.map((d, i) => {
    const s = answers[`c${i}`]?.score
    return { ...d, score: typeof s === 'number' ? Math.round((s / (HUMOR.length - 1)) * 100) / 10 : d.score }
  })
}

// ---------- Posting through Claude's connectors ----------

export const DESTINATIONS = [
  { key: 'slack', label: 'Slack', hotkey: 's', match: /slack/ },
  { key: 'linkedin', label: 'LinkedIn', hotkey: 'l', match: /linkedin/ },
  { key: 'x', label: 'X', hotkey: 'x', match: /twitter|tweet|\bx\.com\b|post_to_x/ },
  { key: 'discord', label: 'Discord', hotkey: 'd', match: /discord/ },
  { key: 'teams', label: 'Teams', hotkey: 't', match: /microsoft teams|\bteams\b/ },
  { key: 'email', label: 'Email', hotkey: 'm', match: /gmail|outlook|send_email|send an email|e-?mail/ },
]

// A guess from the session's tool list: claude.ai connectors often have opaque
// server ids, so match on tool names and descriptions too.
export function connectedDestinations(tools) {
  const haystack = (tools ?? [])
    .filter((t) => t?.mcp)
    .map((t) => `${t.name} ${t.description}`.toLowerCase())
    .join('\n')
  return new Set(DESTINATIONS.filter((d) => d.match.test(haystack)).map((d) => d.key))
}

export function postPrompt(draft, where, isConnected) {
  return `The user approved this meme in the Meme Factory panel and wants it posted to ${where}.

Meme image URL: ${draft.url}
Template: ${draft.template_name}
Caption: ${draft.lines.filter(Boolean).join(' / ')}

Post it to ${where} through the user's connected connectors (MCP tools). The image URL renders as the picture in most apps, so posting the URL (with a short caption if it suits the destination) is usually enough.
${isConnected ? '' : `It looks like no ${where} connector is connected. If you can't find one, tell the user, and help them connect it: search the connector directory if you have a tool for that, or point them to https://claude.ai/directory.\n`}Before posting, confirm the exact destination (channel, account, or recipient) and the final text with the user, since this is public. Don't interrupt any work in progress to do this; handle it when you're free.`
}

export function findConnectorPrompt(site, draft) {
  return `The user wants to post an approved meme to "${site}" (meme image URL: ${draft.url}).
Check whether a connector for ${site} is already connected. If it is, confirm the destination and text with the user, then post. If not, help them find and connect one: search the connector directory if you have a tool for that, otherwise point them to https://claude.ai/directory.`
}

// ---------- Terminal thumbnail: a BMP (from macOS sips) to Raster half-blocks ----------

const DEFAULT_COLOR = 0x01000000
const UPPER_HALF = 0x2580 // ▀: foreground is the top pixel, background the bottom

export function decodeBmp(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (v.getUint16(0, false) !== 0x424d) throw new Error('not a BMP')
  const offset = v.getUint32(10, true)
  const width = v.getInt32(18, true)
  const rawHeight = v.getInt32(22, true)
  const bpp = v.getUint16(28, true)
  const compression = v.getUint32(30, true)
  if (bpp !== 24 && bpp !== 32) throw new Error(`unsupported BMP depth ${bpp}`)
  if (compression !== 0 && compression !== 3) throw new Error('compressed BMP')
  const height = Math.abs(rawHeight)
  const bottomUp = rawHeight > 0
  const stride = Math.ceil((width * bpp) / 32) * 4
  const step = bpp / 8
  const rgb = new Uint32Array(width * height)
  for (let y = 0; y < height; y++) {
    const row = offset + (bottomUp ? height - 1 - y : y) * stride
    for (let x = 0; x < width; x++) {
      const p = row + x * step
      rgb[y * width + x] = (bytes[p + 2] << 16) | (bytes[p + 1] << 8) | bytes[p]
    }
  }
  return { width, height, rgb }
}

export function rasterFromImage({ width, height, rgb }) {
  const rows = Math.ceil(height / 2)
  const cells = new Uint32Array(width * rows * 3)
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < width; x++) {
      const top = rgb[2 * r * width + x]
      const bottom = 2 * r + 1 < height ? rgb[(2 * r + 1) * width + x] : DEFAULT_COLOR
      const c = (r * width + x) * 3
      cells[c] = UPPER_HALF
      cells[c + 1] = top
      cells[c + 2] = bottom
    }
  }
  return { columns: width, rows, cells: new Uint8Array(cells.buffer).toBase64() }
}

export function svgForJpeg(base64, alt) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 480" width="480" height="480"><title>${escapeXml(alt)}</title><image href="data:image/jpeg;base64,${base64}" x="0" y="0" width="480" height="480" preserveAspectRatio="xMidYMid meet"/></svg>`
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c])
}

export function hash(s) {
  let h = 2166136261
  for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
  return h >>> 0
}
