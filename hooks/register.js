// Meme Factory: Claude (or you, via /meme) asks for a meme, drafts cook in a side
// panel without interrupting the session, you give feedback and approve, and
// Claude posts the approved meme through your connectors.
import {
  DESTINATIONS,
  JEV_URL,
  JUDGE_SYSTEM,
  WRITER_SYSTEM,
  applyScores,
  connectedDestinations,
  decodeBmp,
  draftsFromWriter,
  findConnectorPrompt,
  hash,
  jevJudgeBody,
  jevJudgeResult,
  jevPickBody,
  jevPickResult,
  judgePrompt,
  postPrompt,
  rasterFromImage,
  svgForJpeg,
  topDrafts,
  writerPrompt,
} from './lib.js'

const PANE = 'meme-factory'
const TOOL = 'mcp__meme-factory__make_meme'
const THUMB_COLUMNS = 44
const SVG_LIMIT = 120000
const HISTORY_LIMIT = 50

// The current job. Module state: it resets when the module reloads during development.
let job = freshJob()
let seq = 0
// Rendered pictures per draft id: { raster } for the terminal, { svg } for Desktop.
const art = new Map()
let connected = new Set()
let cacheDir = ''

function freshJob() {
  return { status: 'idle', request: '', context: '', feedback: [], drafts: [], selected: 0, error: '', note: '', approved: null, posted: [] }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    const home = await $.env.get('HOME')
    cacheDir = `${home || '/tmp'}/.cache/meme-factory`
    await $.tool.register({
      name: 'make_meme',
      description:
        'Make a meme with the Meme Factory. Use it whenever the user asks for a meme. It returns immediately: drafts appear in a side panel where the user reviews them, gives feedback, and approves one, so do not wait for it or ask the user to describe the result. When they approve, you will get a separate message asking you to post it through their connectors.',
      inputSchema: {
        type: 'object',
        properties: {
          request: { type: 'string', description: "What the meme should be about, in the user's words plus any angle they asked for" },
          context: { type: 'string', description: 'Optional: relevant context from the current work (the bug, the PR, the meeting) that makes the joke land' },
        },
        required: ['request'],
      },
      isDeferred: false,
    })
    // Register commands last: a taken name throws and skips the rest of the hook.
    await $.command.register({
      name: 'meme',
      description: 'Open the Meme Factory panel, or start a meme: /meme <what it is about>',
      argumentHint: '[what the meme is about]',
      immediate: true,
    })
    return next(e)
  })

  // Claude asks for a meme: start cooking in the background and answer right away.
  on('tool.call', { tool: TOOL }, async ($, e) => {
    const request = String(e.request ?? '').trim()
    if (!request) return { result: 'Give make_meme a request describing the meme.' }
    startJob($, request, String(e.context ?? ''))
    const placed = await openPane($, false)
    if (!placed) $.ui.toast('Meme drafts are cooking. Run /meme to open the panel.')
    return {
      result:
        'The Meme Factory is drafting this meme in a side panel. The user will review, give feedback, and approve it there. Carry on with anything else; do not wait. If they approve, a follow-up message will ask you to post it.',
    }
  }).catch(($, e, next) => ({ result: `The Meme Factory couldn't start: ${next.error?.message ?? 'unknown error'}` }))

  // You ask for a meme, or just open the panel.
  on('command.run', { command: 'meme' }, async ($, e) => {
    const request = String(e.args ?? '').trim()
    if (request) startJob($, request, '')
    await openPane($, true)
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    return drawPane($, e)
  })
}

// ---------- The factory line ----------

function startJob($, request, context) {
  const id = ++seq
  job = { ...freshJob(), status: 'working', request, context, note: 'Writing captions…' }
  $.ui.invalidate('ui.render')
  $.clock.after(0, () => cook($, id, null))
}

function remix($, feedback) {
  const id = ++seq
  const previous = job.drafts[job.selected] ?? null
  if (feedback) job = { ...job, feedback: [...job.feedback, feedback] }
  job = { ...job, status: 'working', note: feedback ? 'Reworking with your feedback…' : 'Remixing…', error: '' }
  $.ui.invalidate('ui.render')
  $.clock.after(0, () => cook($, id, previous))
}

async function cook($, id, previous) {
  try {
    const jevKey = await $.env.get('TYPESAFE_API_KEY')
    const latest = job.feedback.at(-1) ?? ''
    const newFormat = !previous || /different|another|new (format|template)|other (format|template)|switch/i.test(latest)
    let templateIds = newFormat ? null : [...new Set([previous.template_id, ...job.drafts.map((d) => d.template_id)])].slice(0, 3)
    if (!templateIds && jevKey) templateIds = await jevPick($, jevKey, job.request)

    const written = await complete(
      $,
      WRITER_SYSTEM,
      writerPrompt({ request: job.request, context: job.context, feedback: job.feedback, previous, templateIds }),
      2000,
    )
    if (id !== seq) return
    let drafts = draftsFromWriter(written)

    job = { ...job, note: 'Judging…' }
    $.ui.invalidate('ui.render')
    drafts = jevKey
      ? await jevJudge($, jevKey, job.request, drafts)
      : applyScores(drafts, await complete($, JUDGE_SYSTEM, judgePrompt(job.request, drafts), 600))
    if (id !== seq) return

    const best = topDrafts(drafts)
    job = { ...job, note: 'Rendering…' }
    $.ui.invalidate('ui.render')
    await renderArt($, best)
    if (id !== seq) return
    job = { ...job, status: 'review', drafts: best, selected: 0, note: '' }
    $.ui.invalidate('ui.render')
  } catch (err) {
    if (id !== seq) return
    job = { ...job, status: 'error', error: err?.message ?? String(err), note: '' }
    $.ui.invalidate('ui.render')
  }
}

// $.model.complete resolves to the text on older builds and to { isAnswered, text } on newer ones.
async function complete($, system, prompt, maxTokens) {
  const model = (await $.env.get('MEME_FACTORY_MODEL')) || 'haiku'
  const reply = await $.model.complete({ model, system, prompt, maxTokens })
  if (typeof reply === 'string') return reply
  if (reply?.isAnswered) return reply.text
  throw new Error(`The model didn't answer${reply?.reason ? `: ${reply.reason}` : ''}`)
}

async function jevPick($, key, request) {
  try {
    const res = await $.http.fetch(JEV_URL, { method: 'POST', headers: jevHeaders(key), body: jevPickBody(request) })
    return res.ok ? jevPickResult(res.text) : null
  } catch {
    return null
  }
}

async function jevJudge($, key, request, drafts) {
  try {
    const res = await $.http.fetch(JEV_URL, { method: 'POST', headers: jevHeaders(key), body: jevJudgeBody(request, drafts) })
    if (res.ok) return jevJudgeResult(res.text, drafts)
  } catch {}
  return applyScores(drafts, await complete($, JUDGE_SYSTEM, judgePrompt(request, drafts), 600))
}

function jevHeaders(key) {
  return { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }
}

// ---------- Pictures ----------

async function renderArt($, drafts) {
  const surfaces = await $.session.surfaces()
  const wantsTerminal = surfaces.includes('terminal')
  const wantsDesktop = surfaces.some((s) => s !== 'terminal')
  await $.process.run(['mkdir', '-p', cacheDir])
  for (const d of drafts) {
    if (art.has(d.id)) continue
    const entry = {}
    try {
      const jpg = `${cacheDir}/${d.id}.jpg`
      await download($, `${d.url.replace(/\.png$/, '.jpg')}?width=360`, jpg)
      if (wantsDesktop) entry.svg = await svgOf($, d, jpg)
      if (wantsTerminal) entry.raster = await rasterOf($, jpg)
    } catch {
      // No picture: the panel still shows the caption and a link.
    }
    art.set(d.id, entry)
  }
}

async function download($, url, path) {
  const r = await $.process.run(['curl', '-sfL', '--max-time', '20', '-o', path, url], { timeoutMs: 25000 })
  if (r.exitCode !== 0) throw new Error(`download failed (${r.exitCode})`)
}

async function svgOf($, d, jpg) {
  let { base64 } = await $.fs.read(jpg, { as: 'bytes' })
  if (base64.length > SVG_LIMIT) {
    const small = jpg.replace(/\.jpg$/, '-s.jpg')
    await download($, `${d.url.replace(/\.png$/, '.jpg')}?width=300`, small)
    base64 = (await $.fs.read(small, { as: 'bytes' })).base64
    if (base64.length > SVG_LIMIT) return null
  }
  return svgForJpeg(base64, d.lines.filter(Boolean).join(' / '))
}

// macOS sips shrinks the picture to a BMP we can decode; elsewhere we skip the thumbnail.
async function rasterOf($, jpg) {
  const bmp = jpg.replace(/\.jpg$/, '.bmp')
  const r = await $.process.run(['sips', '--resampleWidth', String(THUMB_COLUMNS), '-s', 'format', 'bmp', jpg, '--out', bmp])
  if (r.exitCode !== 0) return null
  const { base64 } = await $.fs.read(bmp, { as: 'bytes' })
  return rasterFromImage(decodeBmp(Uint8Array.fromBase64(base64)))
}

// ---------- Approve and post ----------

async function approve($) {
  const draft = job.drafts[job.selected]
  if (!draft) return
  job = { ...job, status: 'approved', approved: draft }
  $.ui.invalidate('ui.render')
  try {
    connected = connectedDestinations(await $.tool.list())
  } catch {
    connected = new Set()
  }
  $.ui.invalidate('ui.render')
  const history = (await $.store.get('history')) ?? []
  const entry = { url: draft.url, template: draft.template_name, lines: draft.lines, request: job.request, at: await $.clock.now() }
  await $.store.set('history', [entry, ...history].slice(0, HISTORY_LIMIT))
}

function sendToClaude($, text, label) {
  job = { ...job, posted: [...job.posted, label] }
  $.ui.invalidate('ui.render')
  $.ui.toast(`Queued for Claude: ${label}. It will pick this up when it's free.`)
  // Resolves when the turn starts, which waits for the session to be idle: don't block on it.
  $.prompt.submit({ text }).catch((err) => $.ui.toast(`Couldn't hand off to Claude: ${err?.message ?? err}`))
}

async function copyLink($, draft) {
  await $.ui.copy({ text: draft.url })
  $.ui.toast('Meme link copied')
}

async function openPane($, byUser) {
  const pane = { id: PANE, title: 'Meme Factory' }
  const placed = await $.ui.open(byUser ? { ...pane, focus: true } : pane)
  return placed?.isPlaced ?? true
}

function reset($) {
  job = freshJob()
  $.ui.invalidate('ui.render')
}

function select($, i) {
  job = { ...job, selected: i }
  $.ui.invalidate('ui.render')
}

function backToDrafts($) {
  job = { ...job, status: 'review' }
  $.ui.invalidate('ui.render')
}

// ---------- Drawing ----------

function drawPane($, e) {
  const el = $.ui.resolve(e)
  const { Box, Text, Button, Input, Link } = el
  const children = [
    Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [
        Text({ bold: true, children: ['Meme Factory'] }),
        Text({ dimColor: true, wrap: 'truncate-end', children: [job.request ? `· ${job.request}` : ''] }),
      ],
    }),
  ]

  if (job.status === 'idle') {
    children.push(
      Text({ dimColor: true, children: ['Ask Claude for a meme, or type one here.'] }),
      Input({
        key: 'request',
        label: 'Meme',
        placeholder: 'when the standup was supposed to be 15 minutes',
        value: '',
        submitLabel: 'make',
        autoFocus: true,
        onSubmit: (value) => value.trim() && startJob($, value.trim(), ''),
      }),
    )
  }

  if (job.status === 'working') {
    children.push(Text({ color: 'warning', children: [job.note || 'Working…'] }))
  }

  if (job.status === 'error') {
    children.push(
      Text({ color: 'error', children: [`The factory jammed: ${job.error}`] }),
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Button({ key: 'retry', label: 'Try again', hotkey: 'r', plain: true, onPress: () => remix($, '') }),
          Button({ key: 'reset', label: 'New meme', hotkey: 'n', plain: true, onPress: () => reset($) }),
        ],
      }),
    )
  }

  if (job.status === 'review') {
    const draft = job.drafts[job.selected]
    children.push(
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: job.drafts.map((d, i) =>
          Button({
            key: `draft-${i}`,
            label: d.template_name,
            hotkey: String(i + 1),
            plain: true,
            dimColor: i !== job.selected,
            onPress: () => select($, i),
          }),
        ),
      }),
      ...picture(el, e, draft),
      ...caption(el, draft),
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Button({ key: 'approve', label: 'Approve', hotkey: 'a', plain: true, onPress: () => approve($) }),
          Button({ key: 'remix', label: 'Remix', hotkey: 'r', plain: true, onPress: () => remix($, '') }),
          Button({ key: 'copy', label: 'Copy link', hotkey: 'c', plain: true, onPress: () => copyLink($, draft) }),
        ],
      }),
      Input({
        key: 'feedback',
        label: 'Feedback',
        placeholder: 'meaner · about Mondays · different format',
        value: '',
        submitLabel: 'remix',
        onSubmit: (value) => value.trim() && remix($, value.trim()),
      }),
    )
  }

  if (job.status === 'approved') {
    const draft = job.approved
    children.push(
      Text({ color: 'success', children: [`Approved: ${draft.template_name}`] }),
      ...picture(el, e, draft),
      ...caption(el, draft),
      Text({ bold: true, children: ['Post it through your connectors:'] }),
      Box({
        flexDirection: 'row',
        flexWrap: 'wrap',
        columnGap: 2,
        children: DESTINATIONS.map((d) =>
          Button({
            key: `post-${d.key}`,
            label: connected.has(d.key) ? `${d.label} ✓` : d.label,
            hotkey: d.hotkey,
            plain: true,
            onPress: () => sendToClaude($, postPrompt(draft, d.label, connected.has(d.key)), d.label),
          }),
        ),
      }),
      Input({
        key: 'elsewhere',
        label: 'Somewhere else',
        placeholder: 'Bluesky, Reddit, a Discord server…',
        value: '',
        submitLabel: 'find connector',
        onSubmit: (value) => value.trim() && sendToClaude($, findConnectorPrompt(value.trim(), draft), value.trim()),
      }),
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Link({ href: 'https://claude.ai/directory', label: 'Browse connectors' }),
          Button({ key: 'copy-approved', label: 'Copy link', hotkey: 'c', plain: true, onPress: () => copyLink($, draft) }),
          Button({ key: 'back', label: 'Back to drafts', hotkey: 'b', plain: true, onPress: () => backToDrafts($) }),
          Button({ key: 'new', label: 'New meme', hotkey: 'n', plain: true, onPress: () => reset($) }),
        ],
      }),
      Text({ dimColor: true, children: ['✓ = looks connected in this session. Claude confirms the destination with you before posting.'] }),
    )
    if (job.posted.length) children.push(Text({ dimColor: true, children: [`Handed to Claude: ${job.posted.join(', ')}`] }))
  }

  return Box({ flexDirection: 'column', rowGap: 1, children })
}

function picture(el, e, draft) {
  const a = art.get(draft.id) ?? {}
  const alt = draft.lines.filter(Boolean).join(' / ')
  if (e.surface === 'terminal' && a.raster && el.Raster) {
    return [el.Raster({ key: `thumb-${hash(draft.id)}`, ...a.raster })]
  }
  if (e.surface !== 'terminal' && a.svg && el.Svg) {
    return [el.Svg({ source: a.svg, alt, width: 320, height: 320 })]
  }
  return []
}

function caption(el, draft) {
  const { Box, Text, Link } = el
  return [
    Box({
      flexDirection: 'column',
      children: draft.lines.filter(Boolean).map((line) => Text({ children: [`“${line}”`] })),
    }),
    Box({
      flexDirection: 'row',
      columnGap: 2,
      children: [
        Link({ href: draft.url, label: 'Open full image' }),
        Text({ dimColor: true, children: [draft.score == null ? '' : `judge ${draft.score}/10`] }),
      ],
    }),
  ]
}
