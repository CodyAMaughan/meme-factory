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
  galleryState,
  isMemePost,
  draftsFromWriter,
  hash,
  jevJudgeBody,
  jevJudgeResult,
  jevPickBody,
  jevPickResult,
  judgePrompt,
  imageCells,
  pngSize,
  postPrompt,
  svgForJpeg,
  topDrafts,
  writerPrompt,
} from './lib.js'

const PANE = 'meme-factory'
const TOOL = 'mcp__meme-factory__make_meme'
const IMAGE_COLUMNS = 56
const SVG_LIMIT = 120000
const HISTORY_LIMIT = 50

// The current job. Module state: it resets when the module reloads during development.
let job = freshJob()
let seq = 0
// Pictures per draft id: { png, size } for the terminal Image, { svg } for Desktop.
const art = new Map()
let connected = new Set()
let cacheDir = ''
// Whether this terminal draws Image pixels (kitty graphics with placeholders). Elsewhere an
// Image still takes its whole box to print its alt text, so we draw a one-line note instead.
let inlineImages = false
// The browser gallery: a local server the mod spawns on demand, { token, port, ready }.
let gallery = null
let settings = { askBeforePost: true, favorites: [] }

function freshJob() {
  return { status: 'idle', request: '', context: '', feedback: [], drafts: [], selected: 0, error: '', note: '', approved: null, posted: [] }
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    const home = await $.env.get('HOME')
    cacheDir = `${home || '/tmp'}/.cache/meme-factory`
    inlineImages = await detectInlineImages($)
    settings = { ...settings, ...((await $.store.get('settings')) ?? {}) }
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
      description: 'Open the Meme Factory panel, start a meme (/meme <what it is about>), or open /meme gallery or /meme settings in your browser',
      argumentHint: '[what the meme is about | gallery | settings]',
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

  // Ask before posting: hold any connector call that carries a meme link until the person says so.
  // $.ui.ask always reaches the person, whatever the permission mode (auto mode included).
  on('tool.call', async ($, e, next) => {
    if (!settings.askBeforePost || !isMemePost(e)) return next(e)
    const tool = String(e.tool).split('__').pop()
    let answer = ''
    try {
      answer = await $.ui.ask(`Meme Factory: let Claude post this meme with ${tool}?`, ['Post it', "Don't post"])
    } catch {
      return { deny: 'The user did not approve posting this meme (no answer).' }
    }
    if (answer !== 'Post it') return { deny: `The user declined posting this meme${answer && answer !== "Don't post" ? `: ${answer}` : ''}.` }
    return next(e)
  })

  // You ask for a meme, or just open the panel.
  on('command.run', { command: 'meme' }, async ($, e) => {
    const request = String(e.args ?? '').trim()
    if (request === 'gallery' || request === 'settings') {
      await openGallery($, request === 'settings' ? 'settings' : 'drafts')
      return { text: 'Opened the Meme Factory gallery in your browser.' }
    }
    if (request) startJob($, request, '')
    await openPane($, true)
    return {}
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    return drawPane($, e)
  })
}

// Mirrors Claude Code's own check: it draws images in kitty and Ghostty (and Ghostty-based
// cmux), never inside tmux or screen, unless CLAUDE_CODE_FORCE_TERMINAL_IMAGES=1.
async function detectInlineImages($) {
  if ((await $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES')) === '1') return true
  if ((await $.env.get('TMUX')) || (await $.env.get('STY'))) return false
  if (await $.env.get('KITTY_WINDOW_ID')) return true
  const term = `${(await $.env.get('TERM_PROGRAM')) ?? ''} ${(await $.env.get('TERM')) ?? ''}`.toLowerCase()
  return /ghostty|kitty|cmux/.test(term)
}

// ---------- The factory line ----------

// Every job change redraws the panel and refreshes the browser gallery, if it's open.
function changed($) {
  $.ui.invalidate('ui.render')
  syncGallery($)
}

function startJob($, request, context) {
  const id = ++seq
  job = { ...freshJob(), status: 'working', request, context, note: 'Writing captions…' }
  changed($)
  $.clock.after(0, () => cook($, id, null))
}

function remix($, feedback) {
  const id = ++seq
  const previous = job.drafts[job.selected] ?? null
  if (feedback) job = { ...job, feedback: [...job.feedback, feedback] }
  job = { ...job, status: 'working', note: feedback ? 'Reworking with your feedback…' : 'Remixing…', error: '' }
  changed($)
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
    changed($)
    drafts = jevKey
      ? await jevJudge($, jevKey, job.request, drafts)
      : applyScores(drafts, await complete($, JUDGE_SYSTEM, judgePrompt(job.request, drafts), 600))
    if (id !== seq) return

    const best = topDrafts(drafts)
    job = { ...job, note: 'Rendering…' }
    changed($)
    await renderArt($, best)
    if (id !== seq) return
    job = { ...job, status: 'review', drafts: best, selected: 0, note: '' }
    changed($)
  } catch (err) {
    if (id !== seq) return
    job = { ...job, status: 'error', error: err?.message ?? String(err), note: '' }
    changed($)
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
  const wantsDesktop = surfaces.some((s) => s !== 'terminal')
  await $.process.run(['mkdir', '-p', cacheDir])
  for (const d of drafts) {
    if (art.has(d.id)) continue
    const entry = {}
    try {
      // The PNG serves the terminal's Image element and the Quick Look viewer.
      const png = `${cacheDir}/${d.id}.png`
      await download($, `${d.url}?width=600`, png)
      const { base64 } = await $.fs.read(png, { as: 'bytes' })
      entry.png = png
      entry.size = pngSize(Uint8Array.fromBase64(base64.slice(0, 64)))
    } catch {
      // No picture: the panel still shows the caption and a link.
    }
    if (wantsDesktop) {
      try {
        entry.svg = await svgOf($, d)
      } catch {}
    }
    art.set(d.id, entry)
  }
}

async function download($, url, path) {
  const r = await $.process.run(['curl', '-sfL', '--max-time', '20', '-o', path, url], { timeoutMs: 25000 })
  if (r.exitCode !== 0) throw new Error(`download failed (${r.exitCode})`)
}

// Desktop draws an Svg as an image, so a JPEG embedded as a data URI shows the meme.
async function svgOf($, d) {
  const jpgUrl = d.url.replace(/\.png$/, '.jpg')
  for (const width of [360, 300]) {
    const jpg = `${cacheDir}/${d.id}-${width}.jpg`
    await download($, `${jpgUrl}?width=${width}`, jpg)
    const { base64 } = await $.fs.read(jpg, { as: 'bytes' })
    if (base64.length <= SVG_LIMIT) return svgForJpeg(base64, d.lines.filter(Boolean).join(' / '))
  }
  return null
}

async function openInBrowser($, url) {
  for (const opener of ['open', 'xdg-open']) {
    try {
      const r = await $.process.run([opener, url])
      if (r.exitCode === 0) return true
    } catch {}
  }
  return false
}

// ---------- Browser gallery ----------

// Starts the local gallery server once per session. It prints READY <port>, then one
// EVENT <json> line per action on the page; the child dies with the session or the mod.
function startGallery($) {
  if (gallery) return gallery.ready
  const bytes = new Uint8Array(24)
  crypto.getRandomValues(bytes)
  const token = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  let resolveReady
  let rejectReady
  const ready = new Promise((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  gallery = { token, port: 0, ready }
  const mine = gallery
  void (async () => {
    let buffered = ''
    try {
      const child = $.process.spawn({ argv: ['python3', `${$.plugin.root}/gallery/server.py`], input: `${token}\n` })
      for await (const { stream, text } of child) {
        if (stream !== 'stdout') continue
        buffered += text
        let nl
        while ((nl = buffered.indexOf('\n')) >= 0) {
          const line = buffered.slice(0, nl).trim()
          buffered = buffered.slice(nl + 1)
          if (line.startsWith('READY ')) {
            mine.port = Number(line.slice(6))
            resolveReady()
            syncGallery($)
          } else if (line.startsWith('EVENT ')) {
            try {
              await onGalleryEvent($, JSON.parse(line.slice(6)))
            } catch {}
          }
        }
      }
    } catch (err) {
      rejectReady(err)
    }
    if (gallery === mine) gallery = null
    rejectReady(new Error('the gallery server stopped'))
  })()
  return ready
}

async function openGallery($, tab = 'drafts') {
  try {
    await startGallery($)
  } catch {
    $.ui.toast('The browser gallery needs python3. Copy the link instead.')
    return
  }
  syncGallery($)
  const ok = await openInBrowser($, `http://127.0.0.1:${gallery.port}/#t=${gallery.token}&tab=${tab}`)
  if (!ok) $.ui.toast(`Open http://127.0.0.1:${gallery.port} in your browser`)
}

function syncGallery($) {
  if (!gallery?.port) return
  const body = JSON.stringify(galleryState(job, connected, settings))
  $.http
    .fetch(`http://127.0.0.1:${gallery.port}/api/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Meme-Token': gallery.token },
      body,
    })
    .catch(() => {})
}

// What the page asks for. Its values are untrusted input: check each one.
async function onGalleryEvent($, ev) {
  const text = (v) => String(v ?? '').trim().slice(0, 300)
  const index = Number(ev.index)
  const validIndex = Number.isInteger(index) && index >= 0 && index < job.drafts.length
  if (ev.type === 'select' && validIndex) select($, index)
  if (ev.type === 'approve' && validIndex && job.status === 'review') {
    select($, index)
    await approve($)
  }
  if (ev.type === 'feedback' && text(ev.text) && job.drafts.length) remix($, text(ev.text))
  if (ev.type === 'remix' && job.request) remix($, '')
  if (ev.type === 'new' && text(ev.request)) startJob($, text(ev.request), '')
  if (ev.type === 'back' && job.drafts.length) backToDrafts($)
  if (ev.type === 'post' && job.approved && text(ev.target)) {
    const target = text(ev.target)
    const quick = DESTINATIONS.find((d) => d.label === target)
    sendToClaude($, postPrompt(job.approved, target, quick ? connected.has(quick.key) : null, settings.askBeforePost), text(ev.label) || target)
  }
  if (ev.type === 'settings' && ev.settings && typeof ev.settings === 'object') await saveSettings($, ev.settings)
}

async function saveSettings($, patch) {
  const next = { ...settings }
  if (typeof patch.askBeforePost === 'boolean') next.askBeforePost = patch.askBeforePost
  if (Array.isArray(patch.favorites)) {
    next.favorites = patch.favorites
      .map((f) => ({ label: String(f?.label ?? '').trim().slice(0, 60), target: String(f?.target ?? '').trim().slice(0, 300) }))
      .filter((f) => f.label && f.target)
      .slice(0, 20)
  }
  settings = next
  await $.store.set('settings', settings)
  changed($)
}

// ---------- Approve and post ----------

async function approve($) {
  const draft = job.drafts[job.selected]
  if (!draft) return
  job = { ...job, status: 'approved', approved: draft }
  changed($)
  try {
    connected = connectedDestinations(await $.tool.list())
  } catch {
    connected = new Set()
  }
  changed($)
  const history = (await $.store.get('history')) ?? []
  const entry = { url: draft.url, template: draft.template_name, lines: draft.lines, request: job.request, at: await $.clock.now() }
  await $.store.set('history', [entry, ...history].slice(0, HISTORY_LIMIT))
}

function sendToClaude($, text, label) {
  job = { ...job, posted: [...job.posted, label] }
  changed($)
  $.ui.toast(`Queued for Claude: ${label}. It will pick this up when it's free.`)
  // Resolves when the turn starts, which waits for the session to be idle: don't block on it.
  $.prompt.submit({ text }).catch((err) => $.ui.toast(`Couldn't hand off to Claude: ${err?.message ?? err}`))
}

async function copyLink($, draft) {
  await $.ui.copy({ text: draft.url })
  $.ui.toast('Meme link copied')
}

async function openPane($, byUser) {
  // rows: the height asked for when the pane sits above the prompt (narrow terminals)
  const pane = { id: PANE, title: 'Meme Factory', rows: 24 }
  const placed = await $.ui.open(byUser ? { ...pane, focus: true } : pane)
  return placed?.isPlaced ?? true
}

function reset($) {
  job = freshJob()
  changed($)
}

function select($, i) {
  job = { ...job, selected: i }
  changed($)
}

function backToDrafts($) {
  job = { ...job, status: 'review' }
  changed($)
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
      Button({ key: 'gallery', label: 'Open gallery and settings in browser', hotkey: 'v', plain: true, onPress: () => openGallery($) }),
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
      ...caption($, el, e, draft),
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Button({ key: 'approve', label: 'Approve', hotkey: 'a', plain: true, onPress: () => approve($) }),
          Button({ key: 'remix', label: 'Remix', hotkey: 'r', plain: true, onPress: () => remix($, '') }),
          Button({ key: 'view', label: 'View in browser', hotkey: 'v', plain: true, onPress: () => openGallery($) }),
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
      ...caption($, el, e, draft),
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
            onPress: () => sendToClaude($, postPrompt(draft, d.label, connected.has(d.key), settings.askBeforePost), d.label),
          }),
        ),
      }),
      Input({
        key: 'elsewhere',
        label: 'Somewhere else',
        placeholder: 'the #memes channel on Slack, Bluesky…',
        value: '',
        submitLabel: 'send to Claude',
        onSubmit: (value) => value.trim() && sendToClaude($, postPrompt(draft, value.trim(), null, settings.askBeforePost), value.trim()),
      }),
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Link({ href: 'https://claude.ai/directory', label: 'Browse connectors' }),
          Button({ key: 'view-approved', label: 'View in browser', hotkey: 'v', plain: true, onPress: () => openGallery($) }),
          Button({ key: 'copy-approved', label: 'Copy link', hotkey: 'c', plain: true, onPress: () => copyLink($, draft) }),
          Button({ key: 'back', label: 'Back to drafts', hotkey: 'b', plain: true, onPress: () => backToDrafts($) }),
          Button({ key: 'new', label: 'New meme', hotkey: 'n', plain: true, onPress: () => reset($) }),
        ],
      }),
      Text({
        dimColor: true,
        children: [
          settings.askBeforePost
            ? '✓ = looks connected. You approve every post before it goes out (change it in the browser gallery).'
            : '✓ = looks connected. Ask-before-posting is off.',
        ],
      }),
    )
    if (job.posted.length) children.push(Text({ dimColor: true, children: [`Handed to Claude: ${job.posted.join(', ')}`] }))
  }

  // Above the prompt (a narrow terminal) every row counts, so drop the blank lines between sections.
  return Box({ flexDirection: 'column', rowGap: e.props?.placement === 'inline' ? 0 : 1, children })
}

function picture(el, e, draft) {
  const a = art.get(draft.id) ?? {}
  const alt = `${draft.template_name}: ${draft.lines.filter(Boolean).join(' / ')}`
  if (e.surface === 'terminal' && !inlineImages) {
    return [el.Text({ dimColor: true, children: ['No inline images in this terminal (Ghostty and kitty have them). Press v to see it in your browser.'] })]
  }
  if (e.surface === 'terminal' && a.png && el.Image) {
    const maxColumns = Math.min(IMAGE_COLUMNS, (e.props?.bodyColumns ?? IMAGE_COLUMNS) - 2)
    return [el.Image({ key: `meme-${hash(draft.id)}`, source: { file: a.png, format: 'png' }, alt, ...imageCells(a.size, maxColumns) })]
  }
  if (e.surface !== 'terminal' && a.svg && el.Svg) {
    return [el.Svg({ source: a.svg, alt: draft.lines.filter(Boolean).join(' / '), width: 320, height: 320 })]
  }
  return []
}

function caption($, el, e, draft) {
  const { Box, Text, Link } = el
  const score = Text({ dimColor: true, children: [draft.score == null ? '' : `judge ${draft.score}/10`] })
  return [
    Box({
      flexDirection: 'column',
      children: draft.lines.filter(Boolean).map((line) => Text({ children: [line] })),
    }),
    // The terminal prints a Link's whole URL after its label; there, View in browser covers it.
    Box({
      flexDirection: 'row',
      columnGap: 2,
      children: e.surface === 'terminal' ? [score] : [Link({ href: draft.url, label: 'Open full image' }), score],
    }),
  ]
}
