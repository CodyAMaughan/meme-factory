// Meme Factory: Claude (or you, via /meme) asks for a meme, drafts cook in a side
// panel without interrupting the session, you chat to refine and approve it, and the
// mod posts it to Slack itself (or hands other destinations to Claude's connectors).
import {
  CHAT_SYSTEM,
  JEV_URL,
  JUDGE_SYSTEM,
  SIGNATURE,
  WRITER_SYSTEM,
  applyScores,
  chatPrompt,
  draftsFromWriter,
  firstSlackLink,
  galleryState,
  hash,
  imageCells,
  isMemePost,
  jevJudgeBody,
  jevJudgeResult,
  jevPickBody,
  jevPickResult,
  judgePrompt,
  parseChatAction,
  parseSlackChannels,
  parseUploadTicket,
  pngSize,
  postPrompt,
  postingConnectors,
  resolveDestination,
  resultText,
  shortName,
  svgForJpeg,
  topDrafts,
  writerPrompt,
} from './lib.js'

const PANE = 'meme-factory'
const TOOL = 'mcp__meme-factory__make_meme'
const IMAGE_COLUMNS = 56
const SVG_LIMIT = 120000
const HISTORY_LIMIT = 50
// Chat lines the docked panel shows; inline shows only the factory's last reply.
const CHAT_LINES = 4
const STAGES = [
  ['write', 'Write'],
  ['judge', 'Judge'],
  ['render', 'Render'],
]

// The current job. Module state: it resets when the module reloads during development.
let job = freshJob()
let seq = 0
// Pictures per draft id: { png, size } for the terminal Image and uploads, { svg } for Desktop.
const art = new Map()
// What the session can post to: { slack: { prefix, canUpload } | null, channels, others }.
let connectors = { slack: null, channels: [], others: [] }
let cacheDir = ''
// Whether this terminal draws Image pixels (kitty graphics with placeholders). Elsewhere an
// Image still takes its whole box to print its alt text, so we draw a one-line note instead.
let inlineImages = false
// The browser gallery: a local server the mod spawns on demand, { token, port, ready }.
let gallery = null
let settings = { askBeforePost: true, signature: true, favorites: [] }

function freshJob() {
  return {
    status: 'idle',
    // While working: 'write' | 'judge' | 'render'
    stage: '',
    request: '',
    context: '',
    feedback: [],
    drafts: [],
    selected: 0,
    error: '',
    note: '',
    approved: null,
    // Posting the approved meme: { stage: 'pick' | 'confirm' | 'posting' | 'done' | 'error', choice, target, link, error }
    post: null,
    posted: [],
    chat: [],
  }
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
        'Make a meme with the Meme Factory. Use it whenever the user asks for a meme. It returns immediately: drafts appear in a side panel where the user reviews them, chats to refine them, approves one, and posts it from the panel, so do not wait for it or ask the user to describe the result. For destinations the panel cannot post to itself, you will get a separate message asking you to post it through their connectors.',
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
        'The Meme Factory is drafting this meme in a side panel. The user will review, refine, approve and post it there. Carry on with anything else; do not wait.',
    }
  }).catch(($, e, next) => ({ result: `The Meme Factory couldn't start: ${next.error?.message ?? 'unknown error'}` }))

  // Ask before posting, for posts Claude makes: hold any connector call that carries a meme
  // link until the person says so. $.ui.ask reaches them in every permission mode. The mod's
  // own Slack uploads are confirmed in the panel instead, so its calls pass straight through.
  on('tool.call', async ($, e, next) => {
    if (!settings.askBeforePost || next.origin?.plugin === $.plugin.name || !isMemePost(e)) return next(e)
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
  job = { ...freshJob(), status: 'working', stage: 'write', request, context, note: 'Writing captions…', chat: job.chat }
  changed($)
  $.clock.after(0, () => cook($, id, null))
}

function remix($, feedback) {
  if (!job.request) return
  const id = ++seq
  const previous = job.drafts[job.selected] ?? null
  if (feedback) job = { ...job, feedback: [...job.feedback, feedback] }
  job = { ...job, status: 'working', stage: 'write', note: feedback ? 'Reworking with your notes…' : 'Remixing…', error: '', approved: null, post: null }
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

    job = { ...job, stage: 'judge', note: 'Judging…' }
    changed($)
    drafts = jevKey
      ? await jevJudge($, jevKey, job.request, drafts)
      : applyScores(drafts, await complete($, JUDGE_SYSTEM, judgePrompt(job.request, drafts), 600))
    if (id !== seq) return

    const best = topDrafts(drafts)
    job = { ...job, stage: 'render', note: 'Rendering…' }
    changed($)
    await renderArt($, best)
    if (id !== seq) return
    job = { ...job, status: 'review', stage: '', drafts: best, selected: 0, note: '' }
    changed($)
  } catch (err) {
    if (id !== seq) return
    job = { ...job, status: 'error', stage: '', error: err?.message ?? String(err), note: '' }
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
      // The PNG serves the terminal's Image element and the Slack upload.
      const png = `${cacheDir}/${d.id}.png`
      await download($, `${d.url}?width=600`, png)
      const { base64 } = await $.fs.read(png, { as: 'bytes' })
      entry.png = png
      entry.size = pngSize(Uint8Array.fromBase64(base64.slice(0, 64)))
    } catch {
      // No picture: the panel still shows the caption.
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

// ---------- Approve and post ----------

async function approve($, index = job.selected) {
  const draft = job.drafts[index]
  if (!draft || job.status !== 'review') return
  job = { ...job, status: 'approved', selected: index, approved: draft, post: { stage: 'pick' } }
  changed($)
  await refreshConnectors($)
  const history = (await $.store.get('history')) ?? []
  const entry = { url: draft.url, template: draft.template_name, lines: draft.lines, request: job.request, at: await $.clock.now() }
  await $.store.set('history', [entry, ...history].slice(0, HISTORY_LIMIT))
}

// Which connectors can post, and the Slack channels the person is in.
async function refreshConnectors($, force = false) {
  try {
    const found = postingConnectors(await $.tool.list())
    let channels = connectors.channels
    if (found.slack && (force || !connectors.slack || !channels.length)) {
      try {
        const r = await $.tool.call({ tool: `${found.slack.prefix}slack_list_user_channels`, exclude_archived: true, limit: 200 })
        channels = parseSlackChannels(resultText(r))
      } catch {
        channels = []
      }
    }
    connectors = { slack: found.slack, channels: found.slack ? channels : [], others: found.others }
  } catch {
    connectors = { slack: null, channels: [], others: [] }
  }
  changed($)
}

// Where to post, from a button, a favorite, or words in the chat box.
function choose($, dest) {
  if (!job.approved || !dest) return
  if (dest.kind === 'claude') {
    handToClaude($, dest.target)
    return
  }
  job = { ...job, post: { stage: settings.askBeforePost ? 'confirm' : 'posting', target: { id: dest.id, name: dest.name } } }
  changed($)
  if (!settings.askBeforePost) $.clock.after(0, () => postToSlack($))
}

function confirmPost($) {
  if (job.post?.stage !== 'confirm') return
  job = { ...job, post: { ...job.post, stage: 'posting' } }
  changed($)
  $.clock.after(0, () => postToSlack($))
}

function cancelPost($) {
  if (!job.approved) return
  // Back to the picker with the last channel still chosen.
  const t = job.post?.target
  job = { ...job, post: { stage: 'pick', choice: t ? { kind: 'slack', id: t.id, name: t.name } : job.post?.choice } }
  changed($)
}

// The mod uploads the image itself, so Slack shows the picture rather than a bare link.
async function postToSlack($) {
  const draft = job.approved
  const target = job.post?.target
  const slack = connectors.slack
  try {
    if (!slack?.canUpload) throw new Error('the Slack connector here cannot upload files')
    const png = art.get(draft.id)?.png ?? `${cacheDir}/${draft.id}.png`
    if (!(await $.fs.exists(png))) await download($, `${draft.url}?width=600`, png)
    const { size } = await $.fs.stat(png)
    const caption = draft.lines.filter(Boolean).join(' / ')
    const ticket = parseUploadTicket(
      resultText(await $.tool.call({ tool: `${slack.prefix}slack_get_file_upload_url`, filename: `${draft.template_id}-meme.png`, content_length: size, alt_txt: caption.slice(0, 1000) })),
    )
    const sent = await $.process.run(['curl', '-sS', '-X', 'POST', '-H', 'Content-Type: image/png', '--data-binary', `@${png}`, ticket.url], { timeoutMs: 60000 })
    if (sent.exitCode !== 0 || !sent.stdout.startsWith('OK')) throw new Error(`the upload failed: ${(sent.stdout || sent.stderr).slice(0, 120)}`)
    const done = await $.tool.call({
      tool: `${slack.prefix}slack_complete_file_upload`,
      file_id: ticket.fileId,
      channel_id: target.id,
      title: caption.slice(0, 100),
      ...(settings.signature ? { initial_comment: SIGNATURE } : {}),
    })
    const link = firstSlackLink(resultText(done))
    job = { ...job, post: { stage: 'done', target, link }, posted: [...job.posted, `#${target.name}`] }
    changed($)
    $.ui.toast(`Posted to #${target.name}`)
  } catch (err) {
    job = { ...job, post: { stage: 'error', target, error: err?.message ?? String(err) } }
    changed($)
  }
}

// Destinations the mod can't post to itself go to Claude, with its connectors.
function handToClaude($, where) {
  if (!job.approved) return
  job = { ...job, posted: [...job.posted, where], post: { stage: 'pick' } }
  changed($)
  $.ui.toast(`Asked Claude to post it to ${where}. It picks this up when it's free.`)
  // Resolves when the turn starts, which waits for the session to be idle: don't block on it.
  $.prompt.submit({ text: postPrompt(job.approved, where, null, settings.askBeforePost) }).catch((err) => $.ui.toast(`Couldn't hand off to Claude: ${err?.message ?? err}`))
}

function addConnector($) {
  $.ui.toast("Asked Claude to help you add a connector. It picks this up when it's free.")
  $.prompt
    .submit({
      text: 'The user wants to add a connector so the Meme Factory can post memes to more places. Ask which app or site they want, search the connector directory for it, and show them its Connect card.',
    })
    .catch(() => {})
}

async function saveFavorite($) {
  const t = job.post?.target
  if (!t) return
  if (settings.favorites.some((f) => f.channelId === t.id)) return
  await saveSettings($, { favorites: [...settings.favorites, { label: `#${t.name}`, target: `#${t.name} on Slack`, channelId: t.id, channelName: t.name }] })
  $.ui.toast(`Saved #${t.name} as a favorite`)
}

// ---------- The chat box ----------

async function chat($, message) {
  const text = String(message ?? '').trim().slice(0, 300)
  if (!text) return
  job = { ...job, chat: [...job.chat, { role: 'you', text }] }
  changed($)
  let reply = ''
  let action = { type: 'none' }
  try {
    ;({ reply, action } = parseChatAction(await complete($, CHAT_SYSTEM, chatPrompt(job, connectors.channels, settings.favorites, text), 400)))
  } catch {
    reply = "Sorry, I didn't catch that. Try “meaner”, “use 2”, “approve” or “post to #social”."
  }
  if (reply) job = { ...job, chat: [...job.chat, { role: 'factory', text: reply }] }
  changed($)
  await act($, action)
}

async function act($, action) {
  const draftIndex = Number(action?.draft) - 1
  const hasDraft = Number.isInteger(draftIndex) && draftIndex >= 0 && draftIndex < job.drafts.length
  switch (action?.type) {
    case 'remix':
      return remix($, String(action.feedback ?? '').slice(0, 300))
    case 'select':
      if (hasDraft && job.status === 'review') select($, draftIndex)
      return
    case 'approve':
      return approve($, hasDraft ? draftIndex : job.selected)
    case 'post': {
      if (!job.approved) await approve($, hasDraft ? draftIndex : job.selected)
      if (!job.approved) return
      if (!connectors.slack && !connectors.others.length) await refreshConnectors($)
      return choose($, resolveDestination(String(action.destination ?? ''), connectors.channels, settings.favorites))
    }
    case 'new':
      if (action.request) startJob($, String(action.request).slice(0, 300), '')
      return
  }
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
    $.ui.toast('The browser gallery needs python3.')
    return
  }
  syncGallery($)
  const ok = await openInBrowser($, `http://127.0.0.1:${gallery.port}/#t=${gallery.token}&tab=${tab}`)
  if (!ok) $.ui.toast(`Open http://127.0.0.1:${gallery.port} in your browser`)
}

function syncGallery($) {
  if (!gallery?.port) return
  const body = JSON.stringify(galleryState(job, connectors, settings))
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
  if (ev.type === 'select' && validIndex && job.status === 'review') select($, index)
  if (ev.type === 'approve' && validIndex) await approve($, index)
  if (ev.type === 'chat') await chat($, text(ev.text))
  if (ev.type === 'remix') remix($, text(ev.text))
  if (ev.type === 'new' && text(ev.request)) startJob($, text(ev.request), '')
  if (ev.type === 'back' && job.drafts.length) backToDrafts($)
  if (ev.type === 'post' && job.approved) {
    const channel = connectors.channels.find((c) => c.id === ev.channelId)
    if (channel) choose($, { kind: 'slack', id: channel.id, name: channel.name })
    else if (text(ev.target)) choose($, resolveDestination(text(ev.target), connectors.channels, settings.favorites))
  }
  if (ev.type === 'confirm') confirmPost($)
  if (ev.type === 'cancel') cancelPost($)
  if (ev.type === 'favorite') await saveFavorite($)
  if (ev.type === 'addConnector') addConnector($)
  if (ev.type === 'refresh') await refreshConnectors($, true)
  if (ev.type === 'reset') reset($)
  if (ev.type === 'settings' && ev.settings && typeof ev.settings === 'object') await saveSettings($, ev.settings)
}

async function saveSettings($, patch) {
  const next = { ...settings }
  if (typeof patch.askBeforePost === 'boolean') next.askBeforePost = patch.askBeforePost
  if (typeof patch.signature === 'boolean') next.signature = patch.signature
  if (Array.isArray(patch.favorites)) {
    next.favorites = patch.favorites
      .map((f) => {
        const fav = { label: String(f?.label ?? '').trim().slice(0, 60), target: String(f?.target ?? '').trim().slice(0, 300) }
        const channel = connectors.channels.find((c) => c.id === f?.channelId) ?? (f?.channelId ? { id: String(f.channelId), name: String(f.channelName ?? '') } : null)
        return channel && /^[CG][A-Z0-9]+$/.test(channel.id) ? { ...fav, channelId: channel.id, channelName: channel.name } : fav
      })
      .filter((f) => f.label && (f.target || f.channelId))
      .slice(0, 20)
  }
  settings = next
  await $.store.set('settings', settings)
  changed($)
}

// ---------- Small transitions ----------

async function copyLink($, draft) {
  await $.ui.copy({ text: draft.url })
  $.ui.toast('Meme link copied')
}

async function openPane($, byUser) {
  // rows: the most the pane takes above the prompt in a narrow terminal. Every inline state
  // fits in 6 rows, plus the frame.
  const pane = { id: PANE, title: 'Meme Factory', rows: 8 }
  const placed = await $.ui.open(byUser ? { ...pane, focus: true } : pane)
  return placed?.isPlaced ?? true
}

function reset($) {
  job = { ...freshJob(), chat: job.chat }
  changed($)
}

function select($, i) {
  job = { ...job, selected: i }
  changed($)
}

function backToDrafts($) {
  job = { ...job, status: 'review', approved: null, post: null }
  changed($)
}

// ---------- Drawing ----------

// State reads from glyphs (● ○ ✓ ✗) and words; theme colors only reinforce them, so the
// panel reads in every terminal theme. No hex colors, and never 'claude' (Claude's orange).

function drawPane($, e) {
  const el = $.ui.resolve(e)
  const { Box, Text, Button } = el
  const inline = e.props?.placement === 'inline'
  const children = [header(el)]

  if (job.status === 'idle') {
    if (!inline) children.push(Text({ dimColor: true, children: ['Ask Claude for a meme, or describe one here.'] }))
  }

  if (job.status === 'working') {
    children.push(stageLine(el))
    // Docked, the old drafts stay put (dimmed) so the panel doesn't jump while it remixes.
    if (!inline && job.drafts.length) {
      const old = job.drafts[job.selected] ?? job.drafts[0]
      children.push(
        Text({ dimColor: true, wrap: 'truncate-end', children: [job.drafts.map((d, i) => `${i + 1}: ○ ${tabLabel(d)}`).join('   ')] }),
        ...caption(el, e, old, { dim: true }),
        Text({ dimColor: true, children: ['These stay until the new drafts land.'] }),
      )
    }
  }

  if (job.status === 'error') {
    children.push(
      Text({ color: 'error', wrap: 'wrap', children: [`✗ The factory jammed: ${job.error}`] }),
      row(el, [
        Button({ key: 'retry', label: 'Try again', hotkey: 'r', plain: true, onPress: () => remix($, '') }),
        Button({ key: 'reset', label: 'New meme', hotkey: 'n', plain: true, onPress: () => reset($) }),
        Button({ key: 'view', label: 'Browser', hotkey: 'v', plain: true, onPress: () => openGallery($) }),
      ]),
    )
  }

  if (job.status === 'review') {
    const draft = job.drafts[job.selected]
    children.push(
      row(
        el,
        job.drafts.map((d, i) =>
          Button({
            key: `draft-${i}`,
            // A Button can't be bold or colored, so the label carries the pick.
            label: `${i === job.selected ? '●' : '○'} ${tabLabel(d)}`,
            hotkey: String(i + 1),
            plain: true,
            dimColor: i !== job.selected,
            onPress: () => select($, i),
          }),
        ),
        3,
      ),
      ...picture(el, e, draft),
      ...caption(el, e, draft),
      ...noPreview(el, e),
      row(el, [
        Button({ key: 'approve', label: 'Approve', hotkey: 'a', plain: true, onPress: () => approve($) }),
        Button({ key: 'remix', label: 'Remix', hotkey: 'r', plain: true, onPress: () => remix($, '') }),
        Button({ key: 'copy', label: 'Copy', hotkey: 'c', plain: true, onPress: () => copyLink($, draft) }),
        Button({ key: 'view', label: 'Browser', hotkey: 'v', plain: true, onPress: () => openGallery($) }),
        talkButton($, el),
      ]),
    )
  }

  if (job.status === 'approved') children.push(...postingView($, el, e))

  if (job.status === 'idle') {
    children.push(chatInput($, el), Button({ key: 'gallery', label: 'Gallery and settings in your browser', hotkey: 'v', plain: true, onPress: () => openGallery($) }))
  } else {
    children.push(...chatView($, el, inline))
  }

  // Above the prompt (a narrow terminal) every row counts, so drop the blank lines between sections.
  return Box({ flexDirection: 'column', rowGap: inline ? 0 : 1, children })
}

function row(el, children, columnGap = 2) {
  return el.Box({ flexDirection: 'row', flexWrap: 'wrap', columnGap, children })
}

// " MEME FACTORY " as a sticker (inverse follows every theme), then where things stand.
function header(el) {
  const { Box, Text } = el
  const post = job.post
  let status = Text({ dimColor: true, wrap: 'truncate-end', children: [job.request || ''] })
  if (job.status === 'approved' && job.approved) {
    const name = shortName(job.approved.template_name, 20)
    if (post?.stage === 'posting') status = Text({ color: 'warning', wrap: 'truncate-end', children: [`● Posting · ${name}`] })
    else if (post?.stage === 'done') status = Text({ color: 'success', wrap: 'truncate-end', children: [`✓ Posted · ${name}`] })
    else if (post?.stage === 'error') status = Text({ color: 'error', wrap: 'truncate-end', children: [`✗ Not posted · ${name}`] })
    else status = Text({ color: 'success', wrap: 'truncate-end', children: [`✓ Approved · ${name}`] })
  }
  return Box({ flexDirection: 'row', columnGap: 2, children: [Text({ bold: true, inverse: true, children: [' MEME FACTORY '] }), status] })
}

function stageLine(el) {
  const { Text } = el
  const at = STAGES.findIndex(([key]) => key === job.stage)
  return row(el, [
    ...STAGES.map(([, label], i) =>
      i < at
        ? Text({ color: 'success', children: [`✓ ${label}`] })
        : i === at
          ? Text({ color: 'warning', children: [`● ${label}`] })
          : Text({ dimColor: true, children: [`○ ${label}`] }),
    ),
    Text({ dimColor: true, wrap: 'truncate-end', children: [job.note || 'Working…'] }),
  ], 3)
}

function tabLabel(d) {
  return `${shortName(d.template_name)}${d.score == null ? '' : ` ${d.score}`}`
}

// t moves the keyboard to the chat box; Tab or Esc moves it back, so hotkeys keep working.
function talkButton($, el) {
  return el.Button({ key: 'talk', label: 'Talk', hotkey: 't', plain: true, onPress: () => $.ui.focus({ requestId: PANE, key: 'chat' }).catch(() => {}) })
}

// ---------- Posting ----------

// What the Post-to picker holds: { kind: 'slack', id, name } or { kind: 'claude', target }.
function defaultChoice() {
  const fav = settings.favorites.find((f) => f.channelId)
  if (fav) return { kind: 'slack', id: fav.channelId, name: fav.channelName ?? fav.label.replace(/^#/, '') }
  const ch = connectors.channels[0]
  return ch ? { kind: 'slack', id: ch.id, name: ch.name } : null
}

function choiceValue(c) {
  return !c ? '' : c.kind === 'slack' ? `slack:${c.id}` : `claude:${c.target}`
}

function choiceLabel(c) {
  return !c ? '' : c.kind === 'slack' ? `#${c.name}` : c.target
}

function setChoice($, choice) {
  if (!job.approved || !choice) return
  job = { ...job, post: { stage: 'pick', choice } }
  changed($)
}

// Favorites first (★), then the person's Slack channels, then places only Claude can reach.
function destinationOptions() {
  const favIds = new Set(settings.favorites.map((f) => f.channelId).filter(Boolean))
  const options = []
  settings.favorites.forEach((f) => {
    if (f.channelId) options.push({ value: `slack:${f.channelId}`, label: `★ #${f.channelName ?? f.label.replace(/^#/, '')}` })
    else options.push({ value: `claude:${f.target}`, label: `★ ${f.label}` })
  })
  for (const c of connectors.channels) if (!favIds.has(c.id)) options.push({ value: `slack:${c.id}`, label: `#${c.name}` })
  for (const label of connectors.others) options.push({ value: `claude:${label}`, label: `${label} (through Claude)` })
  options.push({ value: 'add', label: '+ Add a connector…' })
  // Values must be unique.
  return options.filter((o, i) => options.findIndex((p) => p.value === o.value) === i)
}

function choiceFromValue(value) {
  if (value.startsWith('slack:')) {
    const id = value.slice(6)
    const ch = connectors.channels.find((c) => c.id === id)
    const fav = settings.favorites.find((f) => f.channelId === id)
    return { kind: 'slack', id, name: ch?.name ?? fav?.channelName ?? id }
  }
  if (value.startsWith('claude:')) return { kind: 'claude', target: value.slice(7) }
  return null
}

// Up to three one-key picks: favorite channels first, then the person's other channels.
function quickPicks() {
  const picks = []
  for (const f of settings.favorites) if (f.channelId) picks.push({ kind: 'slack', id: f.channelId, name: f.channelName ?? f.label.replace(/^#/, ''), fav: true })
  for (const c of connectors.channels) if (!picks.some((p) => p.id === c.id)) picks.push({ kind: 'slack', id: c.id, name: c.name })
  return picks.slice(0, 3)
}

function postingView($, el, e) {
  const { Box, Text, Button, Link, Select } = el
  const inline = e.props?.placement === 'inline'
  const draft = job.approved
  const post = job.post ?? { stage: 'pick' }
  const rows = []
  // After approval the picture shrinks to a thumbnail, so the destination fits.
  if (post.stage === 'pick' || post.stage === 'confirm') rows.push(...picture(el, e, draft, { thumb: true }))
  if (post.stage === 'pick') rows.push(...caption(el, e, draft), ...noPreview(el, e))

  if (post.stage === 'pick') {
    const choice = post.choice ?? defaultChoice()
    const options = destinationOptions()
    const picker = Select({
      key: 'post-to',
      label: 'Post to',
      options,
      ...(choice && options.some((o) => o.value === choiceValue(choice)) ? { value: choiceValue(choice) } : {}),
      onSelect: (value) => (value === 'add' ? addConnector($) : setChoice($, choiceFromValue(value))),
    })
    const picks = quickPicks().map((p, i) =>
      Button({
        key: `ch-${p.id}`,
        label: `${p.fav ? '★ ' : ''}#${p.name}`,
        hotkey: String(i + 1),
        plain: true,
        dimColor: choice?.id !== p.id,
        onPress: () => setChoice($, { kind: 'slack', id: p.id, name: p.name }),
      }),
    )
    if (inline) rows.push(row(el, [picker, ...picks]))
    else rows.push(picker, ...(picks.length ? [row(el, picks)] : []))
    rows.push(
      row(el, [
        ...(choice ? [Button({ key: 'post', label: `Post to ${choiceLabel(choice)}`, hotkey: 'p', plain: true, onPress: () => choose($, choice) })] : []),
        Button({ key: 'back', label: 'Back', hotkey: 'b', plain: true, onPress: () => backToDrafts($) }),
        Button({ key: 'copy-approved', label: 'Copy', hotkey: 'c', plain: true, onPress: () => copyLink($, draft) }),
        Button({ key: 'new', label: 'New', hotkey: 'n', plain: true, onPress: () => reset($) }),
        Button({ key: 'view-approved', label: 'Browser', hotkey: 'v', plain: true, onPress: () => openGallery($) }),
      ]),
    )
    if (!inline) {
      rows.push(
        Text({
          dimColor: true,
          children: [
            !connectors.slack && !connectors.others.length
              ? 'No posting connectors yet. Pick "+ Add a connector", or say where in the chat.'
              : settings.askBeforePost
                ? 'You confirm each post · change it in v → Settings'
                : 'Ask-before-posting is off: p posts right away',
          ],
        }),
      )
    }
  }

  if (post.stage === 'confirm') {
    const ask = [
      Text({ bold: true, color: 'permission', children: [`Post to #${post.target.name} on Slack?`] }),
      row(el, [
        Button({ key: 'confirm', label: 'Post it', hotkey: 'y', plain: true, autoFocus: true, onPress: () => confirmPost($) }),
        Button({ key: 'cancel', label: 'Cancel', hotkey: 'n', plain: true, onPress: () => cancelPost($) }),
      ]),
    ]
    if (inline) rows.push(row(el, ask, 3))
    else {
      rows.push(Box({ flexDirection: 'column', borderStyle: 'round', paddingX: 1, children: ask }))
      rows.push(Text({ dimColor: true, children: [settings.signature ? 'Signed "Fresh from the Meme Factory" · Settings in v' : 'Just the meme, no message · Settings in v'] }))
    }
  }

  if (post.stage === 'posting') {
    rows.push(Text({ color: 'warning', children: [`● Posting to #${post.target.name} on Slack…`] }))
    if (!inline) rows.push(Text({ dimColor: true, children: ['Uploading the image. Keep working.'] }))
  }

  if (post.stage === 'done') {
    rows.push(Text({ color: 'success', children: [`✓ Posted to #${post.target.name} on Slack`] }))
    // The terminal prints a Link's whole URL, so it gets a button that opens the browser.
    const open = post.link
      ? e.surface === 'terminal'
        ? [Button({ key: 'open-slack', label: 'Open in Slack', hotkey: 'o', plain: true, onPress: () => openInBrowser($, post.link) })]
        : [Link({ href: post.link, label: 'Open in Slack' })]
      : []
    rows.push(
      row(el, [
        ...open,
        settings.favorites.some((f) => f.channelId === post.target.id)
          ? Text({ dimColor: true, children: ['★ favorite'] })
          : Button({ key: 'favorite', label: `★ Save #${post.target.name}`, hotkey: 's', plain: true, onPress: () => saveFavorite($) }),
        Button({ key: 'again', label: 'Post elsewhere', hotkey: 'p', plain: true, onPress: () => cancelPost($) }),
        Button({ key: 'new', label: 'New meme', hotkey: 'n', plain: true, onPress: () => reset($) }),
      ]),
    )
  }

  if (post.stage === 'error') {
    rows.push(
      Text({ color: 'error', wrap: 'wrap', children: [`✗ Couldn't post to #${post.target?.name ?? 'Slack'}: ${post.error}`] }),
      row(el, [
        Button({ key: 'retry-post', label: 'Retry', hotkey: 'r', plain: true, onPress: () => choose($, { kind: 'slack', id: post.target.id, name: post.target.name }) }),
        Button({ key: 'cancel', label: 'Pick another', hotkey: 'p', plain: true, onPress: () => cancelPost($) }),
        Button({ key: 'claude-post', label: 'Ask Claude', hotkey: 'k', plain: true, onPress: () => handToClaude($, `#${post.target?.name} on Slack`) }),
      ]),
    )
  }

  if (!inline && job.posted.length && post.stage !== 'done') rows.push(Text({ dimColor: true, wrap: 'truncate-end', children: [`Sent so far: ${job.posted.join(', ')}`] }))
  return rows
}

// ---------- Chat ----------

function chatInput($, el) {
  const idle = job.status === 'idle'
  const placeholder = idle
    ? 'when the standup was supposed to be 15 minutes'
    : job.status === 'approved'
      ? 'post it to #social · meaner · new meme about…'
      : 'meaner · use 2 · approve · post to #social'
  return el.Input({
    key: 'chat',
    label: idle ? 'Meme' : 'Say',
    placeholder,
    value: '',
    submitLabel: idle ? 'make' : 'send',
    // autoFocus takes only true. Only the empty panel takes it: elsewhere a focused field
    // would swallow the hotkeys.
    ...(idle ? { autoFocus: true } : {}),
    onSubmit: (value) => (idle ? value.trim() && startJob($, value.trim(), '') : chat($, value)),
  })
}

function chatView($, el, inline) {
  const { Box, Text } = el
  const shown = inline ? job.chat.filter((m) => m.role !== 'you').slice(-1) : job.chat.slice(-CHAT_LINES)
  const lines = shown.map((m) =>
    Box({
      flexDirection: 'row',
      columnGap: 1,
      children: [
        m.role === 'you' ? Text({ dimColor: true, children: ['    you'] }) : Text({ color: 'suggestion', children: ['factory'] }),
        Text({ wrap: inline ? 'truncate-end' : 'wrap', children: [m.text] }),
      ],
    }),
  )
  const rule = !inline && lines.length ? [Text({ dimColor: true, wrap: 'truncate-end', children: ['─'.repeat(120)] })] : []
  return [...rule, ...lines, chatInput($, el)]
}

// ---------- Picture and caption ----------

function picture(el, e, draft, { thumb = false } = {}) {
  if (e.props?.placement === 'inline') return []
  const a = art.get(draft.id) ?? {}
  const alt = `${draft.template_name}: ${draft.lines.filter(Boolean).join(' / ')}`
  if (e.surface === 'terminal' && inlineImages && a.png && el.Image) {
    const bodyColumns = e.props?.bodyColumns ?? IMAGE_COLUMNS + 2
    const bodyRows = e.props?.scroll?.bodyRows ?? 40
    const maxColumns = thumb ? Math.min(28, bodyColumns - 2) : Math.min(IMAGE_COLUMNS, bodyColumns - 2)
    // Leave room under the picture for the caption, actions and chat.
    const maxRows = thumb ? 8 : Math.max(8, bodyRows - 16)
    return [el.Image({ key: `meme-${hash(draft.id)}`, source: { file: a.png, format: 'png' }, alt, ...imageCells(a.size, maxColumns, maxRows) })]
  }
  if (e.surface !== 'terminal' && a.svg && el.Svg) {
    const size = thumb ? 160 : Math.min(480, Math.max(200, (e.props?.bodyColumns ?? 40) * 8))
    return [el.Svg({ source: a.svg, alt: draft.lines.filter(Boolean).join(' / '), width: size, height: size })]
  }
  return []
}

// One line, after the caption, so the joke reads first.
function noPreview(el, e) {
  if (e.surface !== 'terminal' || inlineImages || e.props?.placement === 'inline') return []
  return [el.Text({ dimColor: true, wrap: 'truncate-end', children: ['No preview in this terminal · v opens it in a browser'] })]
}

function caption(el, e, draft, { dim = false } = {}) {
  const { Box, Text, Link } = el
  const lines = draft.lines.filter(Boolean)
  const bar = (children) => Box({ flexDirection: 'row', children: [Text({ dimColor: true, children: ['▎'] }), ...children] })
  if (e.props?.placement === 'inline') {
    return [bar([Text({ dimColor: dim, wrap: 'truncate-end', children: [lines.join(' / ')] })])]
  }
  const out = lines.map((line) => bar([Text({ dimColor: dim, wrap: 'wrap', children: [line] })]))
  // The terminal prints a Link's whole URL after its label; there, v (Browser) covers it.
  if (e.surface !== 'terminal' && !dim) out.push(Link({ href: draft.url, label: 'Open full image' }))
  return out
}
