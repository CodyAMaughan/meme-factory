// Meme Factory: Claude (or you, via /meme) asks for a meme, drafts cook in a side
// panel without interrupting the session, you chat to refine and approve it, and the
// mod posts it to Slack itself (or hands other destinations to Claude's connectors).
import {
  CHAT_SYSTEM,
  GALLERY_EVENTS,
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
  memePath,
  MEMEGEN,
  configureMemegen,
  downloadParams,
  memegenOrigin,
  FACTORY_SERVER,
  FACTORY_CLIENT_KEY,
  imgflipCandidates,
  serverCandidates,
  cardsPrompt,
  parseCards,
  addTemplates,
  removeTemplates,
  TEMPLATE_BY_ID,
  sameMemeName,
  MAX_FULL_CATALOG,
  shortlistFor,
  searchPrompt,
  parseJson,
  jevJudgeBody,
  jevJudgeResult,
  jevPickBody,
  jevPickResult,
  judgePrompt,
  parseChatAction,
  parseSlackChannels,
  parseUploadTicket,
  pngSize,
  POSTER_SYSTEM,
  ownHandback,
  posterOutcome,
  posterHooks,
  posterPrompt,
  postingConnectors,
  resolveDestination,
  resultText,
  shortName,
  templatesNamed,
  quotedText,
  keepShort,
  sizedUrl,
  makeDraft,
  REVIEW_SYSTEM,
  readCacheHook,
  reviewPrompt,
  parseReview,
  applyReview,
  DRAFTS,
  keepNamed,
  svgForJpeg,
  topDrafts,
  writerPrompt,
} from './lib.js'
import { TEMPLATES } from './templates.js'

const PANE = 'meme-factory'
const TOOL = 'mcp__meme-factory__make_meme'
const IMAGE_COLUMNS = 56
const SVG_LIMIT = 120000
const HISTORY_LIMIT = 50
// Chat lines the docked panel shows; inline shows only the factory's last reply.
const CHAT_LINES = 4
const MAX_FAVORITES = 20
const STAGES = [
  ['write', 'Write'],
  ['judge', 'Judge'],
  ['render', 'Render'],
]

// The current job. Module state: it resets when the module reloads during development.
let job = freshJob()
let seq = 0
// True while the panel Claude opened waits undrawn (a narrow terminal): the band above the prompt draws it.
let inBand = false
// The poster agent posting right now ({ agentId }), and its two files: `-path` (the meme it may
// post) and `-posted` (its post, once one went through), named for this session.
let poster = null
let posterFiles = ''
// The helpers this mod started (picture checks, posters): their hand-backs never reach the conversation.
const ownAgents = new Set()
// Pictures per draft id: { png, size } for the terminal Image and uploads, { svg } for Desktop.
const art = new Map()
// What the session can post to: { slack: { prefix, canUpload } | null, channels, others }.
// Why Slack's channels didn't load, for the panel and the debug tool ('' when fine).
let slackProblem = ''
// Recent connector and posting steps, for the debug tool (always kept, a few dozen lines).
const recentLines = []
let connectors = { slack: null, channels: [], others: [] }
let cacheDir = ''
// Whether this terminal draws Image pixels (kitty graphics with placeholders). Elsewhere an
// Image still takes its whole box to print its alt text, so we draw a one-line note instead.
let inlineImages = false
// The sticker wordmark (assets/wordmark.png) as an SVG, for surfaces that draw images.
let wordmark = ''
// Picture checks in flight: the helper agent's id, and what to do with its answer.
const checks = new Map()
// MEME_FACTORY_DEBUG=1 keeps a log of the drafting pipeline in ~/.cache/meme-factory/debug.json.
let debugOn = false
// MEME_FACTORY_CHECK_PICTURES=1 turns the picture check on, as the Settings switch does.
let checkByEnv = false
const debugLines = []
function debug($, step, data = {}) {
  if (!debugOn) return
  debugLines.push({ at: Date.now(), step, ...data })
  $.fs.write(`${cacheDir}/debug.json`, JSON.stringify(debugLines.slice(-200), null, 1)).catch(() => {})
}
// The browser gallery: a local server the mod spawns on demand, { token, port, ready }.
let gallery = null
// The memes this session approved, by memePath: ask-before-posting still knows one after a
// new meme replaces it in the panel.
const approvedPaths = new Set()
// Every meme on screen or approved, as ask-before-posting matches them.
function memePaths() {
  return [...approvedPaths, ...(job.drafts ?? []).map((d) => memePath(d.url))]
}
let settings = { askBeforePost: true, signature: true, quality: 'best', checkPictures: true, favorites: [] }

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
    // "More like this": the one template every draft uses, until a different format.
    lock: null,
    // The person's own words, used verbatim.
    exact: [],
    // A template picked in the gallery before there was a request: the next meme uses it.
    pending: null,
    // The picture check: { state: 'running' | 'done' | 'skipped', fixed }
    check: null,
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
    posterFiles = `${cacheDir}/poster-${String(await $.session.id().catch(() => 'session')).replace(/[^\w-]/g, '')}`
    inlineImages = await detectInlineImages($)
    wordmark = await loadWordmark($)
    debugOn = (await $.env.get('MEME_FACTORY_DEBUG')) === '1'
    checkByEnv = (await $.env.get('MEME_FACTORY_CHECK_PICTURES')) === '1'
    settings = cleanSettings(await $.store.get('settings'))
    await $.tool.register({
      name: 'meme_factory_debug',
      description:
        "Meme Factory troubleshooting, for when the user reports the panel misbehaving (no Slack channels, posts failing). Actions: 'status' (connectors, Slack channels and the last problem, posting state, recent debug log), 'refresh' (look up connectors and Slack channels again), 'upload_check' (test Slack's upload steps without sharing anything), and for testing the panel 'approve' (approve the selected draft) and 'pick' (choose a channel by name). Nothing here posts: only the person's Post it does.",
      inputSchema: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['status', 'refresh', 'upload_check', 'approve', 'pick'] }, channel: { type: 'string', description: "For 'pick': the channel name, like social" } },
      },
      isDeferred: true,
    })
    // Development: a note left in the cache folder is handed to Claude once after a reload, so a
    // test can continue on its own. The note is removed first, so this can't repeat.
    // Per session: other sessions running the same mod (another terminal) never take it.
    const note = `${cacheDir}/.reload-note-${await $.session.id().catch(() => 'none')}`
    if (await $.fs.exists(note)) {
      const text = String(await $.fs.read(note)).slice(0, 2000)
      await $.process.run(['rm', '-f', note])
      $.prompt.submit({ text: `[Meme Factory reloaded] ${text}` }).catch(() => {})
    }
    // The Meme Factory's own memegen server by default (its 1,500 templates, a "Meme Factory"
    // watermark without a key); MEMEGEN_URL picks another, such as https://api.memegen.link.
    const chosenServer = await $.env.get('MEMEGEN_URL')
    usingFactoryServer = !chosenServer
    configureMemegen({
      url: chosenServer || FACTORY_SERVER,
      key: await $.env.get('MEMEGEN_API_KEY'),
      watermark: await $.env.get('MEMEGEN_WATERMARK'),
    })
    // After configureMemegen, so your server's templates are looked up too.
    moreTemplates($).catch((err) => dlog($, `more templates: ${err?.message ?? err}`))
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
    // The picture check: a helper agent that looks at the rendered memes (the mod's own model
    // calls can't see images). Hidden from Claude; only this mod spawns it.
    await $.agent
      .register({
        name: 'picture-check',
        description: 'Meme Factory only: checks rendered meme pictures for caption text that is too small or covers a face.',
        prompt: REVIEW_SYSTEM,
        tools: ['Read'],
        model: 'sonnet',
        maxTurns: 8,
        hooks: readCacheHook(cacheDir),
      })
      .catch(() => {})
    // The poster: posts an approved meme where the mod can't post itself, with your connectors, in
    // the background. Hidden from Claude; only this mod spawns it, after you confirm in the panel.
    await $.agent
      .register({
        name: 'poster',
        description: 'Meme Factory only: posts a meme the person approved and confirmed in the panel.',
        prompt: POSTER_SYSTEM,
        model: 'sonnet',
        maxTurns: 10,
        omitClaudeMd: true,
        hooks: posterHooks(posterFiles),
      })
      .catch(() => {})
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
    // Claude's call opens the pane unasked, which the engine holds back below 144 columns.
    inBand = !(await openPane($, false))
    if (inBand) changed($)
    return {
      result:
        'The Meme Factory is drafting this meme in a side panel. The user will review, refine, approve and post it there. Carry on with anything else; do not wait.',
    }
  }).catch(($, e, next) => ({ result: `The Meme Factory couldn't start: ${next.error?.message ?? 'unknown error'}` }))

  // Ask before posting, for posts Claude makes: hold any connector call that carries a meme
  // link until the person says so. $.ui.ask reaches them in every permission mode. The mod's
  // own posts are confirmed in the panel: its Slack calls go straight to the server, and its
  // poster's calls never reach a mod's hooks (the poster's own hooks hold it to its job).
  on('tool.call', async ($, e, next) => {
    if (!settings.askBeforePost || next.origin?.plugin === $.plugin.name || !isMemePost(e, memePaths())) return next(e)
    const tool = String(e.tool).split('__').pop()
    let answer = ''
    try {
      answer = await $.ui.ask(`Meme Factory: let Claude post this meme with ${tool}?`, ['Post it', "Don't post"])
    } catch {
      return { deny: 'The user did not approve posting this meme (no answer).' }
    }
    if (answer !== 'Post it') return { deny: `The user declined posting this meme${answer && answer !== "Don't post" ? `: ${answer}` : ''}.` }
    return next(e)
  }).catch(() => ({ deny: "The Meme Factory couldn't ask the user about this post, so it was held." }))

  // The fallback in slackCall: the mod's own Slack calls through the listed tool. Approve the channel
  // list and the upload ticket, and the share only while a post the person confirmed is running.
  // (Calls made from a gallery event may not pass through here; the permission rule covers those.)
  on('tool.check', async ($, e, next) => {
    if (next.origin?.plugin !== $.plugin.name) return next(e)
    const tool = String(e.tool)
    const read = /__slack_(list_user_channels|get_file_upload_url)$/.test(tool)
    const share = /__slack_complete_file_upload$/.test(tool) && job.post?.stage === 'posting'
    if (read || share) return { decision: 'allow', reason: 'Meme Factory: its own Slack call (channel list, or the upload you confirmed)' }
    return next(e)
  })

  on('tool.call', { tool: 'mcp__meme-factory__meme_factory_debug' }, async ($, e) => {
    const action = String(e.action ?? 'status')
    if (action === 'refresh') await Promise.all([refreshConnectors($, true), moreTemplates($, true).catch((err) => dlog($, `more templates: ${err?.message ?? err}`))])
    let upload = undefined
    if (action === 'upload_check') upload = await uploadCheck($)
    if (action === 'approve' && job.status === 'review') await approve($, job.selected)
    if (action === 'pick' && job.status === 'approved') {
      const name = String(e.channel ?? '').replace(/^#/, '').toLowerCase()
      const c = connectors.channels.find((x) => x.name.toLowerCase() === name)
      if (c) setChoice($, { kind: 'slack', id: c.id, name: c.name })
    }
    return { result: JSON.stringify(await debugStatus($, upload), null, 1) }
  })

  // You ask for a meme, or just open the panel.
  on('command.run', { command: 'meme' }, async ($, e) => {
    const request = String(e.args ?? '').trim()
    if (request === 'gallery' || request === 'settings') {
      await openGallery($, request === 'settings' ? 'settings' : 'drafts')
      return { text: 'Opened the Meme Factory gallery in your browser.' }
    }
    if (request) startJob($, request, '')
    await openByYou($)
    return {}
  })

  on('agent.offer', { agent: 'meme-factory:picture-check' }, () => ({ isOffered: false }))
  on('agent.offer', { agent: 'meme-factory:poster' }, () => ({ isOffered: false }))

  // A click on a button presses it but leaves the keyboard where it was, so after typing in Say the
  // next hotkey still types into Say. After each press the focus moves to the button pressed, or to
  // the header when the press redrew the panel without it; Talk's own job is to move it into Say.
  on('ui.press', async ($, e, next) => {
    const r = await next(e)
    if (e.plugin === $.plugin.name && e.element !== 'talk') {
      $.ui
        .focus({ requestId: e.requestId, key: e.element })
        .then((f) => (f?.deny ? $.ui.focus({ requestId: e.requestId, key: 'header' }) : f))
        .catch(() => {})
    }
    return r
  })

  // The mod's helpers answer the mod (their turn's end, below). Claude Code also hands their report
  // back to the conversation; that hand-back is dropped, so they never interrupt your work with Claude.
  on('prompt.submit', async ($, e, next) => {
    const id = ownHandback(e, ownAgents)
    if (!id) return next(e)
    ownAgents.delete(id)
    return { drop: 'Meme Factory: its own helper finished; the panel has the answer' }
  })

  // A picture check's answer arrives as its turn's end.
  on('turn.complete', async ($, e, next) => {
    const done = e.agentId && checks.get(e.agentId)
    if (done) {
      checks.delete(e.agentId)
      done(String(e.answer ?? ''))
    }
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    return drawPane($, e)
  })

  // The panel's narrow strip, above the prompt, while the pane Claude opened waits undrawn.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (!inBand || job.status === 'idle' || e.props?.hasSurvey) return next(e)
    if ((await $.ui.panes()).some((p) => p.id === PANE && p.isPlaced)) return next(e)
    return drawPane($, { ...e, props: { ...e.props, placement: 'inline' } })
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

// A new meme starts a new chat: `chat` is what it opens with (the exchange that asked for it, when
// that was the chat box).
function startJob($, request, context, chat = []) {
  const id = ++seq
  // A meme picked in the gallery beforehand: all three drafts use it.
  const lock = job.pending && TEMPLATE_IDS.has(job.pending) ? job.pending : null
  job = { ...freshJob(), status: 'working', stage: 'write', request, context, note: 'Writing captions…', chat, lock }
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
  $.clock.after(0, () => cook($, id, previous, feedback))
}

// "More like this": three fresh drafts on one template (the shown draft's, or one named).
function variations($, templateId = job.drafts[job.selected]?.template_id) {
  if (!job.request || !templateId || job.post?.stage === 'posting') return
  job = { ...job, lock: templateId }
  remix($, '')
  job = { ...job, note: 'Writing variations…' }
  changed($)
}

// Sets a draft's caption to exactly these words: nothing is rewritten.
async function editDraft($, index, lines) {
  const d = job.drafts[index]
  if (!d || job.status !== 'review' || !Array.isArray(lines)) return
  const next = makeDraft(d.template_id, lines.map((l) => String(l ?? '').slice(0, 120)), d.score)
  if (!next) return
  const id = seq
  await renderArt($, [next])
  if (id !== seq || job.status !== 'review') return
  job = { ...job, drafts: job.drafts.map((x, i) => (i === index ? next : x)), selected: index }
  changed($)
}

async function cook($, id, previous, latest = '') {
  try {
    const jevKey = await $.env.get('TYPESAFE_API_KEY')
    const newFormat = !previous || /different|another|new (format|template)|other (format|template)|switch/i.test(latest)
    // Words in quotes are the person's own: they stay, unchanged, until new quotes replace them.
    const quoted = quotedText(latest || (previous ? '' : job.request))
    if (quoted.length) job = { ...job, exact: quoted }
    const exact = job.exact ?? []
    // A template named in the request or the latest note ("use kombucha girl") always gets drafted.
    const named = templatesNamed(latest || (previous ? '' : `${job.request} ${job.context}`))
    // "More like this" holds one template until a different format or another meme is asked for.
    if ((latest && newFormat) || (named.length && !named.includes(job.lock))) job = { ...job, lock: null }
    const lock = job.lock
    let templateIds = lock ? [lock] : newFormat ? null : [...new Set([previous.template_id, ...job.drafts.map((d) => d.template_id)])].slice(0, 3)
    if (!lock && named.length && previous) templateIds = [...new Set([...named, ...(templateIds ?? job.drafts.map((d) => d.template_id))])].slice(0, 3)
    else if (!lock && named.length) templateIds = null
    // A big catalog: the writer sees a shortlist for this joke instead of every template.
    const shortlist = !templateIds && TEMPLATE_BY_ID.size > MAX_FULL_CATALOG ? await searchShortlist($, job) : null
    if (!templateIds && !named.length && jevKey) templateIds = await jevPick($, jevKey, job.request, shortlist)

    const written = await complete(
      $,
      WRITER_SYSTEM,
      writerPrompt({ request: job.request, context: job.context, feedback: job.feedback, previous, templateIds, mustUse: templateIds ? [] : named, exact, variations: Boolean(lock), shortlist }),
      2000,
    )
    if (id !== seq) return
    let drafts = draftsFromWriter(written)
    // One-liners only, but a meme the person named always survives, and so does the locked one.
    drafts = keepShort(drafts, exact, [...named, ...(lock ? [lock] : [])])

    job = { ...job, stage: 'judge', note: 'Judging…' }
    changed($)
    // Shown in a shuffled order, so a candidate's position doesn't sway its score.
    const order = drafts.map((_, i) => i).sort(() => Math.random() - 0.5)
    drafts = jevKey
      ? await jevJudge($, jevKey, job.request, drafts)
      : applyScores(drafts, await complete($, JUDGE_SYSTEM, judgePrompt(job.request, drafts, { exact, named, order }), 900, 'judge').catch(() => ''))
    if (id !== seq) return

    debug($, 'drafts', { kept: drafts.map((d) => `${d.score ?? '-'} ${d.template_id}: ${d.lines.join(' / ')}`) })
    const best = lock ? topDrafts(drafts, DRAFTS, { distinct: false }) : keepNamed(topDrafts(drafts), drafts, named)
    job = { ...job, stage: 'render', note: 'Rendering…' }
    changed($)
    await renderArt($, best)
    if (id !== seq) return
    job = { ...job, status: 'review', stage: '', drafts: best, selected: 0, note: '', approved: null, post: null, check: null }
    changed($)
    // The drafts are on screen; the picture check runs behind them and swaps in fixes.
    if (settings.checkPictures || checkByEnv) checkPictures($, id, exact).catch(() => {})
  } catch (err) {
    if (id !== seq) return
    job = { ...job, status: 'error', stage: '', error: err?.message ?? String(err), note: '' }
    changed($)
  }
}

// Asks the picture-check agent to look at the drafts on screen, then swaps in any fixes:
// a shorter box, or the text moved above the picture. Never blocks the panel.
async function checkPictures($, id, exact) {
  const items = job.drafts
    .map((d, i) => ({ i, path: art.get(d.id)?.png, lines: d.lines, template: d.template_name }))
    .filter((x) => x.path && art.get(job.drafts[x.i].id)?.size)
  if (!items.length) return
  job = { ...job, check: { state: 'running' } }
  changed($)
  let answer = ''
  try {
    // The helper reads the rendered pictures from the mod's cache; Claude Code's own permission
    // rules decide that read (see README: one allow rule for ~/.cache/meme-factory).
    const spawned = await $.agent.spawn({ subagentType: 'meme-factory:picture-check', prompt: reviewPrompt(items), description: 'Checking meme pictures', cwd: cacheDir })
    debug($, 'check spawned', { agentId: spawned?.agentId ?? null, deny: spawned?.deny ?? null, pictures: items.length })
    if (!spawned?.agentId) throw new Error(spawned?.deny ?? 'no agent')
    ownAgents.add(spawned.agentId)
    answer = await Promise.race([
      new Promise((resolve) => checks.set(spawned.agentId, resolve)),
      $.clock.sleep(120000).then(() => {
        checks.delete(spawned.agentId)
        return ''
      }),
    ])
  } catch {
    answer = ''
  }
  debug($, 'check answered', { chars: answer.length, answer: answer.slice(0, 600) })
  if (id !== seq || job.status !== 'review') return
  const fixes = parseReview(answer)
  const updated = []
  for (const [i, problems] of fixes) {
    const d = job.drafts[i]
    const next = d && applyReview(d, problems, exact)
    if (next) updated.push([i, next])
  }
  if (updated.length) await renderArt($, updated.map(([, d]) => d))
  if (id !== seq || job.status !== 'review') return
  const drafts = [...job.drafts]
  for (const [i, d] of updated) drafts[i] = d
  const fixed = updated.reduce((n, [, d]) => n + d.fixed, 0)
  // No verdicts at all usually means the helper couldn't read the pictures.
  const blocked = Boolean(answer) && !/"checks"\s*:/.test(answer)
  job = { ...job, drafts, check: { state: blocked ? 'blocked' : answer ? 'done' : 'skipped', fixed } }
  changed($)
}

// $.model.complete resolves to the text on older builds and to { isAnswered, text } on newer ones.
// Which model does each job. "best" (the default) has Opus write, since drafts cook in the
// background and the writing is what makes them funny; "fast" uses Sonnet throughout.
// MEME_FACTORY_WRITER_MODEL / _JUDGE_MODEL / _CHAT_MODEL, or MEME_FACTORY_MODEL for all three,
// override either preset. Every call runs on the session's own credentials.
const MODELS = {
  best: { writer: 'opus', judge: 'sonnet', chat: 'sonnet', search: 'haiku' },
  fast: { writer: 'sonnet', judge: 'sonnet', chat: 'sonnet', search: 'haiku' },
}

async function complete($, system, prompt, maxTokens, role = 'writer') {
  // Each name is spelled out, so the environment variables the mod reads can be listed.
  const byRole = {
    writer: await $.env.get('MEME_FACTORY_WRITER_MODEL'),
    judge: await $.env.get('MEME_FACTORY_JUDGE_MODEL'),
    chat: await $.env.get('MEME_FACTORY_CHAT_MODEL'),
  }
  const model = byRole[role] || (await $.env.get('MEME_FACTORY_MODEL')) || (MODELS[settings.quality] ?? MODELS.best)[role]
  const started = Date.now()
  const reply = await $.model.complete({ model, system, prompt, maxTokens })
  debug($, 'model', { role, model, ms: Date.now() - started, answered: typeof reply === 'string' || Boolean(reply?.isAnswered) })
  if (typeof reply === 'string') return reply
  if (reply?.isAnswered) return reply.text
  throw new Error(`The model didn't answer${reply?.reason ? `: ${reply.reason}` : ''}`)
}

// More templates than the built-in catalog:
// - your own memegen server's (MEMEGEN_URL): every template it has that memegen.link doesn't,
//   read each session, with the card it serves (card.json) when it has one;
// - Imgflip's popular list, checked once a day: top-and-bottom memes the catalog lacks.
// A template without a card gets one from the model, once, kept in the store; a meme the model
// didn't know is asked about again after a month. MEME_FACTORY_IMGFLIP=0 leaves Imgflip out.
const MORE_EVERY = 24 * 60 * 60 * 1000
const RETRY_SKIPPED = 30 * MORE_EVERY
const CARDS_VERSION = 2
let usingFactoryServer = false
let moreSummary = { served: 0, cards: 0, skipped: 0, checked: null }

async function serverTemplates($) {
  if (memegenOrigin() === 'https://api.memegen.link') return []
  const get = (url) =>
    $.http.fetch(url, { headers: { 'X-Meme-Factory': FACTORY_CLIENT_KEY } }).catch((err) => ({ ok: false, status: String(err?.message ?? err).slice(0, 160) }))
  // A server that sleeps when idle (Railway) can take longer than a fetch allows to wake: ask twice.
  const list = async () => {
    const first = await get(`${memegenOrigin()}/templates/`)
    return first.ok ? first : get(`${memegenOrigin()}/templates/`)
  }
  const [res, upstream] = await Promise.all([list(), get('https://api.memegen.link/templates/')])
  if (!res?.ok || !upstream?.ok) {
    dlog($, `more templates: couldn't list templates (${memegenOrigin()}: ${res?.status}; memegen.link: ${upstream?.status})`)
    // The Meme Factory server is down: draw on memegen.link instead, with the built-in templates.
    if (usingFactoryServer && !res?.ok) {
      configureMemegen({ url: 'https://api.memegen.link', key: MEMEGEN.key, watermark: MEMEGEN.watermark })
      dlog($, 'more templates: the Meme Factory server is unreachable; using memegen.link for now')
    }
    return []
  }
  return serverCandidates(JSON.parse(res.text), undefined, JSON.parse(upstream.text)).map((t) => ({ ...t, origin: memegenOrigin() }))
}

async function moreTemplates($, force = false) {
  // A new CARDS version rewrites every card (when the prompt that writes them improves).
  const stored = (await $.store.get('moreTemplates')) ?? {}
  const kept = stored.version === CARDS_VERSION ? stored : {}
  const cards = Array.isArray(kept.cards) ? kept.cards : []
  const now = Date.now()
  const skipped = Object.fromEntries(Object.entries(kept.skipped && !Array.isArray(kept.skipped) ? kept.skipped : {}).filter(([, at]) => now - at < RETRY_SKIPPED))
  const imgflipOn = (await $.env.get('MEME_FACTORY_IMGFLIP')) !== '0'
  const usable = (t) => (t.source === 'imgflip' ? imgflipOn : t.origin === memegenOrigin())

  // Your server first, so an Imgflip template it also has (by name) gives way to its version.
  const server = await serverTemplates($)
  const ready = server.filter((t) => t.core)
  const fromServer = (t) => t.source === 'imgflip' && ready.some((r) => sameMemeName(r.name, t.name))
  // An Imgflip copy that loaded earlier (while the server was asleep) gives way now.
  removeTemplates(cards.filter((t) => fromServer(t)).map((t) => t.id))
  const served = addTemplates(ready)
  addTemplates(cards.filter(usable).filter((t) => !fromServer(t)))

  const due = force || !kept.checked || now - kept.checked >= MORE_EVERY || kept.origin !== memegenOrigin()
  const fresh = server.filter((t) => !t.core)
  if (due && imgflipOn) {
    const res = await $.http.fetch('https://api.imgflip.com/get_memes').catch(() => null)
    if (res?.ok) fresh.push(...imgflipCandidates(JSON.parse(res.text)).filter((t) => !fromServer(t)))
  }
  const ask = fresh.filter((t) => !skipped[t.id] && !cards.some((c) => c.id === t.id)).slice(0, 60)
  // Fifteen at a time, so a long answer isn't cut off mid-card.
  const made = []
  for (let i = 0; i < ask.length; i += 15) {
    const batch = ask.slice(i, i + 15)
    try {
      const got = parseCards(await complete($, 'You know how every popular meme template is used. Reply with JSON only.', cardsPrompt(batch), 6000, 'judge'), batch)
      made.push(...got)
      for (const t of batch) if (!got.some((m) => m.id === t.id)) skipped[t.id] = now
    } catch (err) {
      dlog($, `more templates: cards failed (${err?.message ?? err})`)
    }
  }
  const all = [...cards, ...made]
  if (due || made.length) await $.store.set('moreTemplates', { version: CARDS_VERSION, checked: due ? now : kept.checked, origin: memegenOrigin(), cards: all, skipped })
  const added = addTemplates(made.filter(usable))
  moreSummary = { served: ready.length, cards: all.length, skipped: Object.keys(skipped).length, checked: due ? now : kept.checked ?? null }
  dlog($, `more templates: ${served} from your server, ${ask.length} asked, ${made.length} new cards, ${added} added (${TEMPLATE_BY_ID.size} in all)`)
  if (added || served) changed($)
}

// Query understanding, then retrieval: a quick model says what kind of joke this is and what the
// right picture would show, and those words join the request for the search.
async function searchShortlist($, job) {
  let extra = ''
  try {
    const answer = await complete($, 'You match jokes to meme templates. Reply with JSON only.', searchPrompt(job.request, job.context), 300, 'search')
    const q = parseJson(answer)
    extra = [q?.shape, ...(Array.isArray(q?.words) ? q.words : [])].filter((w) => typeof w === 'string').join(' ').slice(0, 400)
  } catch {}
  const ids = shortlistFor(`${job.request} ${job.context ?? ''} ${extra}`)
  debug($, 'search', { extra, shortlist: ids.slice(0, 12) })
  return ids
}

async function jevPick($, key, request, shortlist = null) {
  try {
    const res = await $.http.fetch(JEV_URL, { method: 'POST', headers: jevHeaders(key), body: jevPickBody(request, shortlist) })
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
  return applyScores(drafts, await complete($, JUDGE_SYSTEM, judgePrompt(request, drafts), 600, 'judge'))
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
    if (art.get(d.id)?.size) continue
    const entry = {}
    try {
      // The PNG serves the terminal's Image element and the Slack upload.
      Object.assign(entry, await fetchPng($, d))
    } catch {
      // No picture: the panel still shows the caption, and the next render tries again.
    }
    if (wantsDesktop) {
      try {
        entry.svg = await svgOf($, d)
      } catch {}
    }
    if (entry.size || entry.svg) art.set(d.id, entry)
  }
}

// Downloads the meme's PNG to a temp file and moves it into place only when it is a whole
// PNG, so a timed-out or empty download is never drawn or uploaded.
async function fetchPng($, d) {
  const png = `${cacheDir}/${d.id}.png`
  const part = `${png}.part`
  await download($, sizedUrl(d, 600, 'png', downloadParams()), part)
  const { base64 } = await $.fs.read(part, { as: 'bytes' })
  const size = pngSize(Uint8Array.fromBase64(base64.slice(0, 64)))
  const mv = await $.process.run(['mv', '-f', part, png])
  if (mv.exitCode !== 0) throw new Error('could not save the picture')
  return { png, size }
}

// With MEMEGEN_API_KEY, curl reads the key header from stdin (-H @-), so it never shows
// in a URL or in the process list.
async function download($, url, path) {
  const keyed = Boolean(MEMEGEN.key)
  const argv = ['curl', '-sfL', '--max-time', '20', ...(keyed ? ['-H', '@-'] : []), '-o', path, url]
  const r = await $.process.run(argv, { timeoutMs: 25000, ...(keyed ? { stdin: `X-API-KEY: ${MEMEGEN.key}\n` } : {}) })
  if (r.exitCode !== 0) throw new Error(`download failed (${r.exitCode})`)
}

// Desktop draws an Svg as an image, so a JPEG embedded as a data URI shows the meme.
async function svgOf($, d) {
  for (const width of [360, 300]) {
    const jpg = `${cacheDir}/${d.id}-${width}.jpg`
    await download($, sizedUrl(d, width, 'jpg', downloadParams()), jpg)
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
  approvedPaths.add(memePath(draft.url))
  job = { ...job, status: 'approved', selected: index, approved: draft, post: { stage: 'pick' } }
  changed($)
  await refreshConnectors($)
  const stored = await $.store.get('history')
  const history = Array.isArray(stored) ? stored : []
  const entry = { url: draft.url, template: draft.template_name, lines: draft.lines, request: job.request, at: await $.clock.now() }
  await $.store.set('history', [entry, ...history].slice(0, HISTORY_LIMIT))
}

// Which connectors can post, and the Slack channels the person is in.
async function refreshConnectors($, force = false) {
  try {
    const found = postingConnectors(await $.tool.list())
    let slack = found.slack
    let channels = connectors.channels
    dlog($, `connectors: slack ${slack ? (slack.prefix ?? slack.server) : 'not listed'}; others ${found.others.join(', ') || 'none'}`)
    if (slack && (force || !connectors.slack || !channels.length)) {
      try {
        channels = parseSlackChannels(resultText(await slackCall($, slack, 'slack_list_user_channels', { exclude_archived: true, limit: 200 })))
        slackProblem = channels.length ? '' : 'Slack answered with no channels'
      } catch (err) {
        channels = []
        slackProblem = err?.message ?? String(err)
        dlog($, `slack channels failed: ${slackProblem}`)
      }
    }
    // The desktop app can leave on-demand connector tools out of the tool list, so when Slack
    // isn't listed, ask the Slack connector for channels by its server name.
    if (!slack) ({ slack, channels } = await findSlackByName($))
    connectors = { slack, channels: slack ? channels : [], others: found.others }
  } catch {
    connectors = { slack: null, channels: [], others: [] }
  }
  changed($)
}

const SLACK_SERVERS = ['claude.ai Slack', 'claude_ai_Slack', 'Slack']

async function findSlackByName($) {
  for (const server of SLACK_SERVERS) {
    try {
      const r = await $.mcp.call(server, 'slack_list_user_channels', { exclude_archived: true, limit: 200 })
      if (r?.isError) continue
      return { slack: { server, canUpload: true }, channels: parseSlackChannels(resultText(r)) }
    } catch {}
  }
  return { slack: null, channels: [] }
}

// One Slack call. Straight to the server first: the mod's own call, which Claude Code's docs say no
// permission prompt asks about (the person's Post it is the consent). Some builds (the desktop app's
// 2.1.293) still put it to auto mode's classifier, which refuses a call the conversation didn't ask
// for. Then try the listed tool, which the tool.check hook approves, and if that is refused
// too, say which permission rule lets the mod's Slack calls through.
async function slackCall($, slack, tool, args) {
  let r
  try {
    r = await $.mcp.call(slack.server ?? slack.prefix.slice('mcp__'.length, -'__'.length), tool, args)
  } catch (err) {
    const why = err?.message ?? String(err)
    if (!slack.prefix || !REFUSED.test(why)) throw err
    dlog($, `slack ${tool}: mcp.call refused, trying the tool (${why.slice(0, 120)})`)
    r = await $.tool.call({ tool: `${slack.prefix}${tool}`, ...args })
  }
  if (r?.deny) {
    const why = String(r.deny)
    throw new Error(REFUSED.test(why) ? autoModeHint(slack) : `Claude Code blocked ${tool}: ${why.slice(0, 200)}`)
  }
  if (r?.isError) throw new Error(`Slack answered ${tool} with an error: ${resultText(r).slice(0, 200)}`)
  dlog($, `slack ${tool}: ok`)
  return r
}

const REFUSED = /refused|classifier|denied|not allowed/i

// What to add so auto mode lets the mod's Slack calls through, named as this session lists them.
function autoModeHint(slack) {
  const names = SLACK_TOOLS.map((t) => `"${slack.prefix ?? `mcp__${String(slack.server).replace(/\W+/g, '_')}__`}${t}"`)
  return `Auto mode blocked the mod's Slack call. To allow it, add these to "permissions": { "allow": [...] } in ~/.claude/settings.json: ${names.join(', ')}`
}

const SLACK_TOOLS = ['slack_list_user_channels', 'slack_get_file_upload_url', 'slack_complete_file_upload']

// A connector or posting step: kept for the debug tool, in Claude Code's debug log, and with
// MEME_FACTORY_DEBUG=1 also in the transcript and ~/.cache/meme-factory/debug.json.
function dlog($, line) {
  recentLines.push(`${new Date().toISOString().slice(11, 19)} ${line}`)
  if (recentLines.length > 60) recentLines.shift()
  $.ui.log(`meme-factory: ${line}`, { to: 'debug' })
  if (debugOn) $.ui.log(`Meme Factory debug: ${line}`)
  debug($, 'connectors', { line })
}

// Where to post, from a button, a favorite, or words in the chat box. Every place is confirmed
// here in the panel (unless ask-before-posting is off): a Slack channel the mod uploads to itself,
// or anywhere else, which the mod's poster agent posts to in the background.
function choose($, dest) {
  if (!job.approved) return
  // One post at a time: a second request while uploading would post the meme twice.
  if (job.post?.stage === 'posting') {
    $.ui.toast('Still posting the last one. Try again in a moment.')
    return
  }
  if (!dest) return
  const target = dest.kind === 'claude' ? { kind: 'claude', where: dest.target, name: dest.target } : { kind: 'slack', id: dest.id, name: dest.name }
  job = { ...job, post: { stage: settings.askBeforePost ? 'confirm' : 'posting', target } }
  changed($)
  if (!settings.askBeforePost) $.clock.after(0, () => postNow($))
}

function confirmPost($) {
  if (job.post?.stage !== 'confirm') return
  job = { ...job, post: { ...job.post, stage: 'posting' } }
  changed($)
  $.clock.after(0, () => postNow($))
}

function postNow($) {
  return job.post?.target?.kind === 'claude' ? postByAgent($) : postToSlack($)
}

// A post's target back as a Post-to choice.
function choiceOf(t) {
  return t.kind === 'claude' ? { kind: 'claude', target: t.where } : { kind: 'slack', id: t.id, name: t.name }
}

// "#social on Slack", or the place in your words.
function targetLabel(t) {
  return t?.kind === 'claude' ? t.name : `#${t?.name ?? 'Slack'} on Slack`
}

function cancelPost($) {
  if (!job.approved || job.post?.stage === 'posting') return
  // Back to the picker with the last place still chosen.
  const t = job.post?.target
  job = { ...job, post: { stage: 'pick', choice: t ? choiceOf(t) : job.post?.choice } }
  changed($)
}

// The mod uploads the image itself, so Slack shows the picture rather than a bare link.
async function postToSlack($) {
  const draft = job.approved
  const target = job.post?.target
  const slack = connectors.slack
  // The job can move on while the upload runs (a new meme, back to drafts): then the
  // result belongs to nothing on screen.
  const id = seq
  const current = () => id === seq && job.approved?.id === draft.id
  try {
    if (!slack?.canUpload) throw new Error('the Slack connector here cannot upload files')
    let picture = art.get(draft.id)
    if (!picture?.size) {
      picture = { ...picture, ...(await fetchPng($, draft)) }
      art.set(draft.id, picture)
    }
    const png = picture.png
    const { size } = await $.fs.stat(png)
    const caption = draft.lines.filter(Boolean).join(' / ')
    const ticket = parseUploadTicket(
      resultText(await slackCall($, slack, 'slack_get_file_upload_url', { filename: `${draft.template_id}-meme.png`, content_length: size, alt_txt: caption.slice(0, 1000) })),
    )
    const sent = await $.process.run(['curl', '-sS', '-X', 'POST', '-H', 'Content-Type: image/png', '--data-binary', `@${png}`, ticket.url], { timeoutMs: 60000 })
    if (sent.exitCode !== 0 || !sent.stdout.startsWith('OK')) throw new Error(`the upload failed: ${(sent.stdout || sent.stderr).slice(0, 120)}`)
    const done = await slackCall($, slack, 'slack_complete_file_upload', {
      file_id: ticket.fileId,
      channel_id: target.id,
      title: caption.slice(0, 100),
      ...(settings.signature ? { initial_comment: SIGNATURE } : {}),
    })
    if (done?.isError || done?.deny) throw new Error(String(done.deny ?? resultText(done) ?? 'Slack refused the post').slice(0, 160))
    const link = firstSlackLink(resultText(done))
    if (!current()) {
      $.ui.toast(`Posted to #${target.name}`)
      return
    }
    job = { ...job, post: { stage: 'done', target, link }, posted: [...job.posted, `#${target.name}`] }
    changed($)
    dlog($, `posted to #${target.name}: ${link ?? 'no link'}`)
    $.ui.toast(`Posted to #${target.name}`)
  } catch (err) {
    dlog($, `post to #${target?.name} failed: ${err?.message ?? err}`)
    if (!current()) {
      $.ui.toast(`Couldn't post to #${target?.name}: ${err?.message ?? err}`)
      return
    }
    job = { ...job, post: { stage: 'error', target, error: err?.message ?? String(err) } }
    changed($)
  }
}

// What the debug tool reports: enough to see why a step failed, nothing private (no keys).
async function debugStatus($, upload) {
  let version = ''
  try {
    version = JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`)).version
  } catch {}
  return {
    mod: version,
    claudeCode: await $.session.version().then((v) => v?.version, () => 'unknown'),
    surfaces: await $.session.surfaces().catch(() => []),
    debug: debugOn,
    slack: connectors.slack ? { via: connectors.slack.prefix ? 'tool list' : `server name ${connectors.slack.server}`, canUpload: connectors.slack.canUpload } : null,
    channels: connectors.channels.map((c) => `#${c.name}`),
    slackProblem,
    others: connectors.others,
    job: { status: job.status, post: job.post?.stage ?? null, choice: job.post?.choice ? `#${job.post.choice.name ?? job.post.choice.target ?? ''}` : null },
    // Where the panel is on screen: placed, or waiting (a narrow terminal) with the band above the prompt.
    pane: await $.ui.panes().then((ps) => ps.find((p) => p.id === PANE) ?? null, () => null),
    inBand,
    poster: poster ? { agentId: poster.agentId } : null,
    memegen: memegenOrigin(),
    templates: { total: TEMPLATE_BY_ID.size, ...moreSummary },
    ...(upload ? { upload } : {}),
    log: recentLines.slice(-30),
  }
}

// Slack's upload steps without sharing: an upload URL and the bytes, never the final step.
async function uploadCheck($) {
  const slack = connectors.slack
  if (!slack) return 'no Slack connector found; run refresh'
  try {
    const png = `${cacheDir}/upload-check.png`
    await download($, sizedUrl(makeDraft('drake', ['upload', 'check'], 0), 300, 'png', downloadParams()), png)
    const { size } = await $.fs.stat(png)
    const ticket = parseUploadTicket(resultText(await slackCall($, slack, 'slack_get_file_upload_url', { filename: 'upload-check.png', content_length: size, alt_txt: 'Meme Factory upload check' })))
    const sent = await $.process.run(['curl', '-sS', '-X', 'POST', '-H', 'Content-Type: image/png', '--data-binary', `@${png}`, ticket.url], { timeoutMs: 60000 })
    return sent.stdout.startsWith('OK') ? `ok: Slack accepted ${size} bytes (not shared anywhere)` : `upload refused: ${(sent.stdout || sent.stderr).slice(0, 120)}`
  } catch (err) {
    return `failed: ${err?.message ?? err}`
  }
}

// Anywhere the mod can't post itself: its poster agent posts there in the background, with your
// connectors, and its answer comes back to the panel. Nothing reaches your conversation with Claude.
async function postByAgent($) {
  const draft = job.approved
  const target = job.post?.target
  const id = seq
  const current = () => id === seq && job.approved?.id === draft.id
  let result
  try {
    // Without its hooks (a cache path the shell can't hold) it would post unguarded, and ask in the chat.
    if (!posterHooks(posterFiles)) throw new Error("the posting helper can't run safely here: the cache folder's path has unusual characters")
    await $.fs.write(`${posterFiles}-path`, memePath(draft.url))
    await $.fs.write(`${posterFiles}-posted`, '')
    const spawned = await $.agent.spawn({ subagentType: 'meme-factory:poster', prompt: posterPrompt(draft, target.where, settings.signature), description: 'Posting a meme' })
    if (!spawned?.agentId) throw new Error(spawned?.deny ?? "the posting helper didn't start")
    ownAgents.add(spawned.agentId)
    poster = { agentId: spawned.agentId }
    dlog($, `poster ${spawned.agentId}: posting to ${target.where}`)
    const answer = await Promise.race([
      new Promise((resolve) => checks.set(spawned.agentId, resolve)),
      $.clock.sleep(180000).then(() => {
        checks.delete(spawned.agentId)
        return ''
      }),
    ])
    const posted = await $.fs.read(`${posterFiles}-posted`).then((text) => String(text).trim() !== '', () => false)
    result = posterOutcome(answer, posted)
  } catch (err) {
    result = { posted: false, reason: err?.message ?? String(err) }
  } finally {
    poster = null
    await $.fs.write(`${posterFiles}-path`, '').catch(() => {})
    await $.fs.write(`${posterFiles}-posted`, '').catch(() => {})
  }
  const where = (result.posted && result.where) || target.where
  dlog($, result.posted ? `poster posted to ${where}: ${result.link ?? 'no link'}` : `poster didn't post: ${result.reason}`)
  if (!current()) {
    $.ui.toast(result.posted ? `Posted to ${where}` : `Couldn't post to ${target.where}: ${result.reason}`)
    return
  }
  job = result.posted
    ? { ...job, post: { stage: 'done', target: { ...target, name: where }, link: result.link }, posted: [...job.posted, where] }
    : { ...job, post: { stage: 'error', target, error: result.reason } }
  changed($)
  if (result.posted) $.ui.toast(`Posted to ${where}`)
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
  if (settings.favorites.length >= MAX_FAVORITES) {
    $.ui.toast(`You have ${MAX_FAVORITES} favorites. Remove one in Settings (v) to add #${t.name}.`)
    return
  }
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
    ;({ reply, action } = parseChatAction(await complete($, CHAT_SYSTEM, chatPrompt(job, connectors.channels, settings.favorites, text, connectors.others), 400, 'chat')))
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
      if (action.draft != null && !hasDraft) return
      return approve($, hasDraft ? draftIndex : job.selected)
    case 'post': {
      if (job.post?.stage === 'posting') return choose($, null)
      if (action.draft != null && !hasDraft) return
      const words = String(action.destination ?? '').slice(0, 100)
      // No place named: only a channel the person already picked counts.
      if (!words.trim() && !job.post?.choice) {
        job = { ...job, chat: [...job.chat, { role: 'factory', text: 'Where should it go? Pick a channel, or say "post to #channel".' }] }
        changed($)
        return
      }
      // "post 2" when another draft is approved: switch to that one first.
      if (job.approved && hasDraft && job.drafts[draftIndex]?.id !== job.approved.id) backToDrafts($)
      if (!job.approved) await approve($, hasDraft ? draftIndex : job.selected)
      if (!job.approved) return
      if (!connectors.slack && !connectors.others.length) await refreshConnectors($)
      return choose($, words.trim() ? resolveDestination(words, connectors.channels, settings.favorites) : job.post.choice)
    }
    case 'new':
      if (action.request) startJob($, String(action.request).slice(0, 300), '', job.chat.slice(-2))
      return
    case 'variations': {
      if (job.status !== 'review') return
      const named = action.template ? templatesNamed(`use ${action.template}`)[0] ?? (TEMPLATE_IDS.has(action.template) ? action.template : null) : null
      if (action.template && !named) return
      return variations($, named ?? (hasDraft ? job.drafts[draftIndex].template_id : undefined))
    }
    case 'edit':
      if (Array.isArray(action.lines)) return editDraft($, hasDraft ? draftIndex : job.selected, action.lines)
      return
  }
}

const TEMPLATE_IDS = { has: (id) => TEMPLATE_BY_ID.has(id) }

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
      const child = $.process.spawn({ argv: ['python3', `${$.plugin.root}/gallery/server.py`], input: `${token}\n${GALLERY_EVENTS.join(',')}\n${memegenOrigin()}\n` })
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
  // Not awaited: a model call shouldn't hold up the clicks queued behind it.
  if (ev.type === 'chat') chat($, text(ev.text)).catch(() => {})
  if (ev.type === 'remix') remix($, text(ev.text))
  if (ev.type === 'variations' && job.status === 'review') variations($, validIndex ? job.drafts[index].template_id : undefined)
  // A meme chosen from the gallery's picker: three takes on it now, or on the next meme.
  if (ev.type === 'useTemplate' && TEMPLATE_IDS.has(String(ev.id))) {
    if (job.status === 'review') variations($, String(ev.id))
    else if (job.status === 'idle' || job.status === 'error') {
      job = { ...job, pending: String(ev.id) }
      changed($)
    }
  }
  if (ev.type === 'new' && text(ev.request)) startJob($, text(ev.request), '')
  if (ev.type === 'back' && job.status === 'approved' && job.post?.stage !== 'posting') backToDrafts($)
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

// Settings as stored can be anything (an older version, a hand edit): keep what's valid.
function cleanSettings(stored) {
  const s = stored && typeof stored === 'object' ? stored : {}
  return {
    askBeforePost: typeof s.askBeforePost === 'boolean' ? s.askBeforePost : true,
    signature: typeof s.signature === 'boolean' ? s.signature : true,
    quality: s.quality === 'fast' ? 'fast' : 'best',
    checkPictures: s.checkPictures !== false,
    favorites: (Array.isArray(s.favorites) ? s.favorites : [])
      .filter((f) => f && typeof f === 'object' && typeof f.label === 'string' && f.label.trim())
      .map((f) => ({
        label: f.label.trim().slice(0, 60),
        target: String(f.target ?? '').slice(0, 300),
        ...(typeof f.channelId === 'string' && /^[CG][A-Z0-9]+$/.test(f.channelId) ? { channelId: f.channelId, channelName: String(f.channelName || f.channelId).slice(0, 80) } : {}),
      }))
      .filter((f) => f.target || f.channelId)
      .slice(0, MAX_FAVORITES),
  }
}

async function saveSettings($, patch) {
  const next = { ...settings }
  if (typeof patch.askBeforePost === 'boolean') next.askBeforePost = patch.askBeforePost
  if (typeof patch.signature === 'boolean') next.signature = patch.signature
  if (patch.quality === 'best' || patch.quality === 'fast') next.quality = patch.quality
  if (typeof patch.checkPictures === 'boolean') next.checkPictures = patch.checkPictures
  if (Array.isArray(patch.favorites)) {
    next.favorites = patch.favorites
      .map((f) => {
        const fav = { label: String(f?.label ?? '').trim().slice(0, 60), target: String(f?.target ?? '').trim().slice(0, 300) }
        const channel = connectors.channels.find((c) => c.id === f?.channelId) ?? (f?.channelId ? { id: String(f.channelId), name: String(f.channelName || f.channelId).slice(0, 80) } : null)
        return channel && /^[CG][A-Z0-9]+$/.test(channel.id) ? { ...fav, channelId: channel.id, channelName: channel.name } : fav
      })
      .filter((f) => f.label && (f.target || f.channelId))
      .filter((f, i, all) => !f.channelId || all.findIndex((g) => g.channelId === f.channelId) === i)
      .slice(0, MAX_FAVORITES)
  }
  settings = next
  await $.store.set('settings', settings)
  changed($)
}

// ---------- Small transitions ----------

async function copyLink($, draft) {
  try {
    await $.ui.copy({ text: draft.url })
    $.ui.toast('Meme link copied')
  } catch {
    $.ui.toast(`Couldn't copy. The link: ${draft.url}`)
  }
}

// For presses that start async work: report a failure instead of dropping it.
function guard($, work) {
  Promise.resolve()
    .then(work)
    .catch((err) => $.ui.toast(`Meme Factory: ${err?.message ?? err}`))
}

async function openPane($, byUser) {
  // rows: the most the pane takes above the prompt in a narrow terminal. Every inline state
  // fits in 6 rows, plus the frame.
  const pane = { id: PANE, title: 'Meme Factory', rows: 8 }
  const placed = await $.ui.open(byUser ? { ...pane, focus: true } : pane)
  return placed?.isPlaced ?? true
}

// Opened by you (/meme, or the band's button), the pane is placed at any width (docked beside the
// transcript from 110 columns, and from then on when Claude opens it too), so the band steps aside.
async function openByYou($) {
  if ((await openPane($, true)) && inBand) {
    inBand = false
    changed($)
  }
}

// New: a fresh start, chat included.
function reset($) {
  seq++
  job = freshJob()
  changed($)
}

function select($, i) {
  job = { ...job, selected: i }
  changed($)
}

function backToDrafts($) {
  if (job.post?.stage === 'posting') return
  seq++
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
  const children = [header($, el, e)]

  if (job.status === 'idle') {
    const picked = job.pending && TEMPLATES.find((t) => t.id === job.pending)
    if (picked) children.push(Text({ color: 'suggestion', wrap: 'truncate-end', children: [`Next meme uses ${picked.name}`] }))
    else if (!inline) children.push(Text({ dimColor: true, children: ['Ask Claude for a meme, or describe one here.'] }))
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
    children.push(...keys($, el, e, []))
  }

  if (job.status === 'error') {
    children.push(
      Text({ color: 'error', wrap: 'wrap', children: [`✗ The factory jammed: ${job.error}`] }),
      ...keys($, el, e, [Button({ key: 'retry', label: 'Try again', hotkey: 'r', plain: true, onPress: () => remix($, '') })]),
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
      ...checkNote(el),
      ...keys(
        $,
        el,
        e,
        [
          Button({ key: 'approve', label: 'Approve', hotkey: 'a', plain: true, onPress: () => guard($, () => approve($)) }),
          Button({ key: 'remix', label: 'Remix', hotkey: 'r', plain: true, onPress: () => remix($, '') }),
          Button({ key: 'more', label: 'More like this', hotkey: 'm', plain: true, onPress: () => variations($) }),
        ],
        { draft },
      ),
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

// A screen's own actions, then the keys every screen has, in the same place and order: Copy (the
// meme on screen), New, Browser, Talk. Docked they're two rows; in a narrow terminal, where every
// row counts, one. A yes/no question keeps n for No, so New steps out while it's asked.
function keys($, el, e, own, { draft = null, withNew = true } = {}) {
  const { Button } = el
  const always = [
    ...(draft ? [Button({ key: 'copy', label: 'Copy', hotkey: 'c', plain: true, onPress: () => copyLink($, draft) })] : []),
    ...(withNew ? [Button({ key: 'new', label: 'New', hotkey: 'n', plain: true, onPress: () => reset($) })] : []),
    Button({ key: 'view', label: 'Browser', hotkey: 'v', plain: true, onPress: () => openGallery($) }),
    talkButton($, el, e),
  ]
  if (e.props?.placement === 'inline' || !own.length) return [row(el, [...own, ...always])]
  return [row(el, own), row(el, always)]
}

// " MEME FACTORY " as a sticker (inverse follows every theme), then where things stand.
// The wordmark the repo, the gallery and the videos use, at 2x for sharp edges.
async function loadWordmark($) {
  try {
    const { base64 } = await $.fs.read(`${$.plugin.root}/assets/wordmark.png`, { as: 'bytes' })
    const { width, height } = pngSize(Uint8Array.fromBase64(base64.slice(0, 64)))
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width / 2}" height="${height / 2}"><title>Meme Factory</title><image href="data:image/png;base64,${base64}" width="${width}" height="${height}"/></svg>`
  } catch {
    return ''
  }
}

// The brand mark: the sticker where images draw (Desktop), and the sticker's colors as a
// text block in the terminal, the same in every theme.
function brand(el, e) {
  if (e.surface !== 'terminal' && wordmark && el.Svg) return el.Svg({ source: wordmark, alt: 'Meme Factory', width: 150, height: 34 })
  return el.Text({ bold: true, color: '#19141F', backgroundColor: '#D9F24A', children: [' MEME FACTORY '] })
}

function header($, el, e) {
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
  // In the band, the panel is one press away: the engine places a pane you open yourself.
  const open = e.component === 'AbovePrompt' ? [el.Button({ key: 'open-pane', label: 'Open the panel', hotkey: 'e', plain: true, onPress: () => openByYou($) })] : []
  // In the terminal the header is a Button that does nothing when pressed: a click on the panel's
  // top then counts as a press, which takes the keyboard out of the chat box (see the ui.press hook),
  // and a sent message has somewhere to land (see chatInput).
  const head =
    e.surface === 'terminal'
      ? [el.Button({ key: 'header', label: 'Meme Factory', plain: true, onPress: () => {}, children: [brand(el, e), '  ', status] })]
      : [brand(el, e), status]
  return Box({ flexDirection: 'row', columnGap: 2, alignItems: 'center', children: [...head, ...open] })
}

// What the picture check is doing, in one dim line (nothing once it found nothing to fix).
function checkNote(el) {
  const c = job.check
  if (!c) return []
  if (c.state === 'running') return [el.Text({ dimColor: true, wrap: 'truncate-end', children: ['Checking how the pictures read…'] })]
  if (c.state === 'blocked') return [el.Text({ dimColor: true, wrap: 'truncate-end', children: ["Picture check couldn't read the images, so the drafts are unchecked"] })]
  if (c.state === 'done' && c.fixed) return [el.Text({ color: 'success', wrap: 'truncate-end', children: [`✓ Adjusted ${c.fixed} ${c.fixed === 1 ? 'box' : 'boxes'} so ${c.fixed === 1 ? 'it reads' : 'they read'}`] })]
  return []
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
// The pane's or the band's chat box, whichever this draw is in.
function talkButton($, el, e) {
  return el.Button({ key: 'talk', label: 'Talk', hotkey: 't', plain: true, onPress: () => $.ui.focus({ requestId: e.requestId, key: 'chat' }).catch(() => {}) })
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
  for (const f of settings.favorites) {
    if (f.channelId && !picks.some((p) => p.id === f.channelId)) picks.push({ kind: 'slack', id: f.channelId, name: f.channelName || f.label.replace(/^#/, ''), fav: true })
  }
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
    if (connectors.slack && !connectors.channels.length) {
      rows.push(
        Text({ color: 'warning', wrap: 'wrap', children: [`Slack is connected, but its channels didn't load: ${slackProblem || 'still looking'}. Or say "post it to #channel" in the chat.`] }),
        row(el, [Button({ key: 'slack-retry', label: 'Try again', hotkey: 'r', plain: true, onPress: () => refreshConnectors($, true) })]),
      )
    }
    rows.push(
      ...keys(
        $,
        el,
        e,
        [
          ...(choice ? [Button({ key: 'post', label: `Post to ${choiceLabel(choice)}`, hotkey: 'p', plain: true, onPress: () => choose($, choice) })] : []),
          Button({ key: 'back', label: 'Back', hotkey: 'b', plain: true, onPress: () => backToDrafts($) }),
        ],
        { draft },
      ),
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
      Text({ bold: true, color: 'permission', wrap: 'wrap', children: [`Post to ${targetLabel(post.target)}?`] }),
      row(el, [
        Button({ key: 'confirm', label: 'Post it', hotkey: 'y', plain: true, autoFocus: true, onPress: () => confirmPost($) }),
        Button({ key: 'cancel', label: 'Cancel', hotkey: 'n', plain: true, onPress: () => cancelPost($) }),
      ]),
    ]
    if (inline) rows.push(row(el, ask, 3))
    else {
      rows.push(Box({ flexDirection: 'column', borderStyle: 'round', paddingX: 1, children: ask }))
      const how = post.target.kind === 'claude' ? 'A helper posts the link with your connectors · ' : ''
      rows.push(Text({ dimColor: true, wrap: 'wrap', children: [`${how}${settings.signature ? 'Signed "Fresh from the Meme Factory" · Settings in v' : 'Just the meme, no message · Settings in v'}`] }))
    }
    rows.push(...keys($, el, e, [], { draft, withNew: false }))
  }

  if (post.stage === 'posting') {
    rows.push(Text({ color: 'warning', wrap: 'truncate-end', children: [`● Posting to ${targetLabel(post.target)}…`] }))
    if (!inline) rows.push(Text({ dimColor: true, children: [post.target.kind === 'claude' ? 'A helper is posting it in the background. Keep working.' : 'Uploading the image. Keep working.'] }))
    rows.push(...keys($, el, e, [], { draft }))
  }

  if (post.stage === 'done') {
    rows.push(Text({ color: 'success', wrap: 'truncate-end', children: [`✓ Posted to ${targetLabel(post.target)}`] }))
    // The terminal prints a Link's whole URL, so it gets a button that opens the browser.
    const openLabel = post.target.kind === 'claude' ? 'Open the post' : 'Open in Slack'
    const open = post.link
      ? e.surface === 'terminal'
        ? [Button({ key: 'open-slack', label: openLabel, hotkey: 'o', plain: true, onPress: () => openInBrowser($, post.link) })]
        : [Link({ href: post.link, label: openLabel })]
      : []
    const favorite =
      post.target.kind === 'claude'
        ? []
        : settings.favorites.some((f) => f.channelId === post.target.id)
          ? [Text({ dimColor: true, children: ['★ favorite'] })]
          : [Button({ key: 'favorite', label: `★ Save #${post.target.name}`, hotkey: 's', plain: true, onPress: () => guard($, () => saveFavorite($)) })]
    rows.push(...keys($, el, e, [...open, ...favorite, Button({ key: 'again', label: 'Post elsewhere', hotkey: 'p', plain: true, onPress: () => cancelPost($) })], { draft }))
  }

  if (post.stage === 'error') {
    rows.push(
      Text({ color: 'error', wrap: 'wrap', children: [`✗ Couldn't post to ${targetLabel(post.target)}: ${post.error}`] }),
      ...keys(
        $,
        el,
        e,
        [
          Button({ key: 'retry-post', label: 'Retry', hotkey: 'r', plain: true, onPress: () => choose($, choiceOf(post.target)) }),
          Button({ key: 'cancel', label: 'Pick another', hotkey: 'p', plain: true, onPress: () => cancelPost($) }),
        ],
        { draft },
      ),
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
    // Returns at once: Claude Code clears the field only when the handler returns, so waiting
    // on the chat (a model call, then a remix) would leave your message sitting there. Once the send
    // is done, the focus leaves the field for the header, so the next hotkey works (t comes back):
    // the field kept the keys after a send. Moved while the send was still running, the keys fell
    // to Claude's prompt instead.
    onSubmit: (value, input) => {
      $.clock.after(0, () => $.ui.focus({ requestId: input.requestId, key: 'header' }).catch(() => {}))
      void (idle ? value.trim() && startJob($, value.trim(), '') : guard($, () => chat($, value)))
    },
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
  if (e.surface === 'terminal' && inlineImages && a.png && a.size && el.Image) {
    const bodyColumns = e.props?.bodyColumns ?? IMAGE_COLUMNS + 2
    const bodyRows = e.props?.scroll?.bodyRows ?? 40
    const maxColumns = thumb ? Math.min(28, bodyColumns - 2) : Math.min(IMAGE_COLUMNS, bodyColumns - 2)
    // Narrower than this, a picture is unreadable: the caption carries it.
    if (maxColumns < 12) return []
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
