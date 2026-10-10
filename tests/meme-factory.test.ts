import { expect, mock, test } from 'claude-code/testing'
import {
  GALLERY_EVENTS,
  SIGNATURE,
  applyScores,
  encodeLine,
  imageCells,
  memeUrl,
  parseJson,
  pngSize,
  shortName,
  templatesNamed,
  quotedText,
  keepShort,
  parseReview,
  readCacheHook,
  memePath,
  isMemePost,
  applyReview,
  makeDraft,
  fitsBudget,
  chatPrompt,
  ownHandback,
  parsePosted,
  posterOutcome,
  posterHooks,
  posterPrompt,
  postingConnectors,
  resolveDestination,
  topDrafts,
  writerPrompt,
  judgePrompt,
  serverCandidates,
  parseCards,
  knownTemplate,
  addTemplates,
  galleryState,
  pickerTemplates,
  removeTemplates,
  rankTemplates,
  shortlistFor,
  popularity,
} from '../hooks/lib.js'

const TOOL = 'mcp__meme-factory__make_meme'
const SLACK = 'mcp__sl4ck__'

const PANE = {
  plugin: 'meme-factory',
  component: 'Pane',
  requestId: 'meme-factory',
  viewport: { columns: 160, rows: 50 },
  props: {
    title: 'Meme Factory',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'meme-factory',
  component: 'AbovePrompt',
  requestId: 'above-prompt',
  viewport: { columns: 100, rows: 40 },
  props: { hasSurvey: false, isWorking: true, maxRows: 12, bodyColumns: 95, scroll: { offset: 0, bodyRows: 11 }, view: {} },
} as const

const USAGE ={ input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const WRITER_REPLY = JSON.stringify({
  candidates: [
    { template_id: 'drake', lines: ['a 15 minute standup', 'a 45 minute standup'] },
    { template_id: 'drake', lines: ['async updates', 'everyone reads their Jira tickets aloud'] },
    { template_id: 'fine', lines: ['', 'standup is at minute 40, this is fine'] },
    { template_id: 'fine', lines: ['', 'this is fine'] },
    { template_id: 'cmm', lines: ['standups should be emails'] },
    { template_id: 'cmm', lines: ['nobody needs a standup'] },
  ],
})
// drake 9, fine 8, cmm 7: drafts come out Drakeposting, This is Fine, Change My Mind
const JUDGE_REPLY = '```json\n{"scores":[{"i":0,"score":6},{"i":1,"score":9},{"i":2,"score":8},{"i":3,"score":2},{"i":4,"score":7},{"i":5,"score":3}]}\n```'

const CHANNELS_REPLY =
  '## My Channels (showing 2 of 2 total)\n\n### #all-maughanco\n- **ID:** C0C524GFGCF\n- **Type:** Public Channel\n\n### #social\n- **ID:** C0C5HB6PETU\n- **Type:** Public Channel\n'
const TICKET_REPLY = 'Upload URL generated successfully!\n\nFile ID: F0TESTFILE1\nUpload URL: https:\\/\\/files.slack.com\\/upload\\/v1\\/ABC123\n\nInstructions: ...'
const DONE_REPLY = JSON.stringify({ file_id: 'F0TESTFILE1', permalink: 'https://maughanco.slack.com/files/U0/F0TESTFILE1/drake-meme.png' })

// The first bytes of a 600x400 PNG: signature, then the IHDR chunk.
function pngHeader(width = 600, height = 400): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const v = new DataView(bytes.buffer)
  v.setUint32(16, width)
  v.setUint32(20, height)
  return bytes
}

type Rig = {
  chatReply?: (prompt: string) => object
  termProgram?: string
  settings?: object
  env?: Record<string, string>
  // Leave Slack's tools out of $.tool.list, as the desktop app can for on-demand tools
  slackUnlisted?: boolean
  // Refuse Slack calls on Claude's tool path, as auto mode does for calls no request of the person's asked for
  slackDenied?: boolean
  // Answer the mod's own Slack calls with this error
  slackError?: string
  // Refuse the mod's $.mcp.call Slack calls, as the desktop app's 2.1.293 auto mode does
  mcpRefused?: boolean
  // Wrap Slack's replies the way the desktop app does: [{ type: 'text', text: '{"result":"..."}' }]
  desktopShape?: boolean
  // A terminal under 144 columns
  narrow?: boolean
  // Answer MEMEGEN_URL's /templates/ with these
  serverTemplates?: object[]
  // The cards model's reply for new templates
  cardsReply?: object
  // How long the chat box's model takes to answer, on the mocked clock
  chatDelay?: number
  // What the store holds at the start
  store?: Record<string, unknown>
}

// Stubs everything the mod reaches: the model, the shell, files, the store, and three
// connectors: Slack (postable, uploads), Gmail (postable) and Microsoft 365 (Teams search only).
function factory(on, rig: Rig = {}) {
  const log = { stdins: [] as string[], ran: [] as string[][], submitted: [] as string[], copied: [] as string[], calls: [] as any[], asked: [] as string[], prompts: [] as string[], models: [] as Array<{ system: string; model: string }>, written: [] as Array<{ path: string; text: string }>, fetched: [] as string[] }
  const saved = new Map<string, unknown>([...Object.entries(rig.store ?? {}), ...(rig.settings ? ([['settings', rig.settings]] as [string, unknown][]) : [])])
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('env.get', ($, e) => ({ value: ({ HOME: '/Users/test', TERM_PROGRAM: rig.termProgram ?? 'ghostty', MEMEGEN_URL: 'https://api.memegen.link', ...rig.env } as Record<string, string>)[e.name] }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  // A narrow terminal holds back a pane the mod opens on its own; one you open is placed at any width.
  let placed = false
  on('ui.open', ($, e) => {
    placed = !rig.narrow || Boolean(e.focus)
    return { value: placed ? { isPlaced: true } : { isPlaced: false, reason: 'opened unasked under 144 columns (100 now)' } }
  })
  on('ui.panes', () => ({ value: [{ id: 'meme-factory', title: 'Meme Factory', isShown: placed, isFocused: false, isPlaced: placed }] }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.copy', ($, e) => {
    log.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('session.surfaces', () => ({ value: ['terminal', 'desktop'] }))
  on('model.complete', async ($, e) => {
    log.prompts.push(e.prompt)
    log.models.push({ system: String(e.system), model: e.model })
    if (String(e.prompt).includes('Describe the ideal meme template')) return { value: { isAnswered: true, text: JSON.stringify({ name: 'Zz Big Rodent', shape: 'reaction', core: 'Shock.', slots: ['', ''], picture: 'a rodent' }), usage: USAGE } }
    if (String(e.prompt).includes('Which 15 templates above')) return { value: { isAnswered: true, text: JSON.stringify({ ids: ['big-007'] }), usage: USAGE } }
    if (String(e.prompt).includes('Which 25 of these')) return { value: { isAnswered: true, text: JSON.stringify({ ids: ['big-042', 'not-a-template'] }), usage: USAGE } }
    if (String(e.prompt).includes('Write a catalog card')) return { value: { isAnswered: true, text: JSON.stringify(rig.cardsReply ?? { cards: [] }), usage: USAGE } }
    if (e.system.includes('judge')) return { value: { isAnswered: true, text: JUDGE_REPLY, usage: USAGE } }
    if (e.system.includes('chat box') && rig.chatDelay) await clock.sleep(rig.chatDelay)
    if (e.system.includes('chat box')) return { value: { isAnswered: true, text: JSON.stringify(rig.chatReply?.(e.prompt) ?? { reply: 'Hi!', action: { type: 'none' } }), usage: USAGE } }
    return { value: { isAnswered: true, text: WRITER_REPLY, usage: USAGE } }
  })
  if (rig.serverTemplates) {
    on('http.fetch', ($, e) => {
      log.fetched.push(e.url)
      if (String(e.url).endsWith('/templates/') && e.init?.headers?.['X-Meme-Factory'] !== 'mf-open-2026') return { value: { status: 403, ok: false, headers: {}, text: '' } }
      const body =
        e.url === 'https://api.memegen.link/templates/' ? [{ id: 'drake', name: 'Drakeposting', lines: 2 }]
        : String(e.url).endsWith('/templates/') ? rig.serverTemplates
        : null
      return { value: body ? { status: 200, ok: true, headers: {}, text: JSON.stringify(body) } : { status: 404, ok: false, headers: {}, text: '' } }
    })
  }
  on('process.run', ($, e) => {
    log.ran.push(e.argv)
    log.stdins.push(e.init?.stdin ?? '')
    const isUpload = e.argv[0] === 'curl' && e.argv.includes('--data-binary')
    return { value: { exitCode: 0, stdout: isUpload ? 'OK - 323850' : '', stderr: '' } }
  })
  on('fs.read', ($, e) => ({ value: { base64: /\.png(\.part)?$/.test(e.path) ? pngHeader().toBase64() : 'SlBFRw==' } }))
  on('fs.write', ($, e) => {
    log.written.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('fs.exists', ($, e) => ({ value: !String(e.path).includes('.reload-note') }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 323850, mtimeMs: 0, isLink: false } }))
  on('tool.list', () => ({
    value: [
      { name: `${SLACK}slack_send_message`, description: 'Send a message', mcp: true },
      { name: `${SLACK}slack_list_user_channels`, description: 'List channels', mcp: true },
      { name: `${SLACK}slack_get_file_upload_url`, description: 'Upload URL', mcp: true },
      { name: `${SLACK}slack_complete_file_upload`, description: 'Finish upload', mcp: true },
      { name: 'mcp__gm41l__send_message', description: 'Send a Gmail email', mcp: true },
      { name: 'mcp__m365__chat_message_search', description: 'Search Microsoft Teams chats', mcp: true },
      { name: 'Bash', description: 'Run a shell command', mcp: false },
    ].filter((t) => !(rig.slackUnlisted && t.name.startsWith(SLACK))),
  }))
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      log.asked.push(e.questions[0].question)
      return { result: { answers: { [e.questions[0].question]: 'Post it' } } }
    }
    log.calls.push(e)
    if (rig.slackDenied && String(e.tool).startsWith(SLACK)) return { deny: 'The server-side auto mode classifier gave no verdict for this action.' }
    const slackReply = { slack_list_user_channels: CHANNELS_REPLY, slack_get_file_upload_url: TICKET_REPLY, slack_complete_file_upload: DONE_REPLY }[String(e.tool).slice(SLACK.length)]
    if (String(e.tool).startsWith(SLACK) && slackReply) return { result: { content: [{ type: 'text', text: slackReply }] } }
    return { result: 'sent' }
  })
  // The mod's own Slack calls go straight to the server; logged under the tool's full name.
  on('mcp.call', ($, e) => {
    if (rig.mcpRefused) return { deny: `The server-side auto mode classifier gave no verdict for mcp__${e.server}__${e.tool}.` }
    log.calls.push({ server: e.server, tool: `mcp__${e.server}__${e.tool}`, ...e.args })
    const reply = { slack_list_user_channels: CHANNELS_REPLY, slack_get_file_upload_url: TICKET_REPLY, slack_complete_file_upload: DONE_REPLY }[e.tool] ?? 'sent'
    const text = rig.slackError ?? reply
    return { value: { content: [{ type: 'text', text: rig.desktopShape ? JSON.stringify({ result: text }) : text }], isError: Boolean(rig.slackError) } }
  })
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    log.submitted.push(e.text)
    return { text: e.text }
  })
  return { clock, saved, log }
}

async function draftsReady($, clock, surface = 'terminal') {
  await $.session.start({ surface, isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'meme', args: 'standups that run long' })
  await clock.settle()
}

test('Claude asks for a meme: the tool returns at once and the drafts cook in the panel', async ($, on) => {
  const { clock } = factory(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const answer = await $.tool.call({ tool: TOOL, tool_use_id: 't1', request: 'standups that run long' })
  expect(answer.result).toMatch(/side panel/)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Writing captions/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '● Write' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '○ Render' })).toBeDefined()
  await ui.unmount()
  await clock.settle()

  const review = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The pick lives in the label (● / ○) with the judge's score, since a Button can't be bold
  expect((await review.find({ key: 'draft-0' }))?.props.label).toMatch(/^● Drakeposting \d+$/)
  expect((await review.find({ key: 'draft-1' }))?.props.label).toMatch(/^○ This is Fine/)
  expect(await review.find({ type: 'Text', text: ' MEME FACTORY ' })).toMatchObject({ props: { color: '#19141F', backgroundColor: '#D9F24A' } })
  expect(await review.find({ type: 'Text', text: 'everyone reads their Jira tickets aloud' })).toBeDefined()
  // A real picture in the terminal: the Image element reads the cached PNG, keeping its 3:2 shape
  const image = await review.find({ type: 'Image' })
  expect(image).toMatchObject({ props: { source: { format: 'png' }, columns: 56, rows: 19 } })
  expect((image as any).props.source.file).toMatch(/^\/Users\/test\/\.cache\/meme-factory\/drake-.*\.png$/)
  // The chat box replaces the old feedback field
  expect(await review.find({ key: 'chat' })).toBeDefined()
  expect(await review.find({ key: 'feedback' })).toBeUndefined()
})

test('approve, pick a real Slack channel, confirm, and the mod uploads the image itself', async ($, on) => {
  const { clock, log, saved } = factory(on)
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'draft-1' })
  await ui.press({ key: 'approve' })

  // Real destinations: the person's Slack channels, Gmail through Claude, no Teams (read-only search)
  expect(await ui.find({ key: 'ch-C0C524GFGCF' })).toMatchObject({ props: { label: '#all-maughanco' } })
  expect(await ui.find({ key: 'ch-C0C5HB6PETU' })).toMatchObject({ props: { label: '#social' } })
  const values = ((await ui.find({ key: 'post-to' }))?.props.options ?? []).map((o: any) => o.value)
  expect(values).toEqual(['slack:C0C524GFGCF', 'slack:C0C5HB6PETU', 'claude:Email', 'add'])
  expect(await ui.find({ key: 'post' })).toMatchObject({ props: { label: 'Post to #all-maughanco' } })

  // A quick pick chooses; p posts (after the confirm)
  await ui.press({ key: 'ch-C0C5HB6PETU' })
  expect(log.calls.some((c) => c.tool === `${SLACK}slack_get_file_upload_url`)).toBe(false)
  await ui.press({ key: 'post' })
  expect(await ui.find({ type: 'Text', text: 'Post to #social on Slack?' })).toBeDefined()
  expect(log.calls.some((c) => c.tool === `${SLACK}slack_complete_file_upload`)).toBe(false)

  await ui.press({ key: 'confirm' })
  await clock.settle()

  const ticket = log.calls.find((c) => c.tool === `${SLACK}slack_get_file_upload_url`)
  expect(ticket).toMatchObject({ content_length: 323850, filename: 'fine-meme.png' })
  const upload = log.ran.find((argv) => argv.includes('--data-binary'))
  expect(upload?.at(-1)).toBe('https://files.slack.com/upload/v1/ABC123')
  expect(upload?.find((a) => a.startsWith('@'))).toMatch(/^@\/Users\/test\/\.cache\/meme-factory\/fine-.*\.png$/)
  const done = log.calls.find((c) => c.tool === `${SLACK}slack_complete_file_upload`)
  expect(done).toMatchObject({ file_id: 'F0TESTFILE1', channel_id: 'C0C5HB6PETU', initial_comment: SIGNATURE })
  expect(SIGNATURE).toBe('Fresh from the <https://github.com/CodyAMaughan/meme-factory|Meme Factory> :factory:')

  // The mod's own Slack calls skip the Claude-side gate: the panel's Post it was the approval
  expect(log.asked.length).toBe(0)
  expect(log.submitted.length).toBe(0)
  expect(await ui.find({ type: 'Text', text: '✓ Posted to #social on Slack' })).toBeDefined()
  // The terminal prints a Link's whole URL, so the message link is a button that opens the browser
  await ui.press({ key: 'open-slack' })
  expect(log.ran.some((argv) => argv[0] === 'open' && argv[1] === 'https://maughanco.slack.com/files/U0/F0TESTFILE1/drake-meme.png')).toBe(true)

  await ui.press({ key: 'favorite' })
  expect((saved.get('settings') as any).favorites).toEqual([{ label: '#social', target: '#social on Slack', channelId: 'C0C5HB6PETU', channelName: 'social' }])
})

test('with ask-before-posting off, picking a channel posts straight away', async ($, on) => {
  const { clock, log } = factory(on, { settings: { askBeforePost: false, signature: false, favorites: [] } })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  await ui.press({ key: 'post' })
  await clock.settle()
  const done = log.calls.find((c) => c.tool === `${SLACK}slack_complete_file_upload`)
  expect(done).toMatchObject({ channel_id: 'C0C524GFGCF' })
  expect(done.initial_comment).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '✓ Posted to #all-maughanco on Slack' })).toBeDefined()
})

test('the chat box understands "use 2 and post it to #social"', async ($, on) => {
  const { clock, log } = factory(on, {
    chatReply: (prompt) => {
      expect(prompt).toContain('Slack channels: ') // the model sees what it can route to
      return { reply: 'Draft 2 it is, headed for #social.', action: { type: 'post', draft: 2, destination: 'post it to #social' } }
    },
  })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'chat', text: 'use 2 and post it to #social' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'use 2 and post it to #social' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'factory' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Draft 2 it is, headed for #social.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '✓ Approved · This is Fine' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Post to #social on Slack?' })).toBeDefined()
  expect(log.calls.some((c) => c.tool === `${SLACK}slack_complete_file_upload`)).toBe(false)
})

test('the chat box remixes, and a place the mod cannot reach itself is confirmed in the panel, not handed to Claude', async ($, on) => {
  let next: object = { reply: 'Meaner coming up.', action: { type: 'remix', feedback: 'make it meaner' } }
  const { clock, log } = factory(on, { chatReply: () => next })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'chat', text: 'meaner please' })
  await clock.settle()
  expect(log.prompts.some((p) => p.includes('"make it meaner"') && p.includes('Use exactly these templates: drake'))).toBe(true)

  next = { reply: 'Sending it to LinkedIn.', action: { type: 'post', destination: 'my LinkedIn' } }
  await ui.input({ key: 'chat', text: 'approve it and put it on my LinkedIn' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'Post to my LinkedIn?' })).toBeDefined()
  expect(log.submitted).toEqual([])
})

test('the browser gallery drives the same flow: chat, pick a channel, confirm', async ($, on) => {
  const pushed: any[] = []
  const spawned: any[] = []
  const { clock, log } = factory(on)
  on('process.spawn', async function* ($, e) {
    spawned.push(e)
    yield { stream: 'stdout', text: 'READY 5555\nEVENT {"type":"select","index":2}\nEVENT {"type":"approve","index":2}\n' }
    yield { stream: 'stdout', text: 'EVENT {"type":"post","channelId":"C0C524GFGCF"}\nEVENT {"type":"confirm"}\n' }
    yield { stream: 'stdout', text: 'EVENT {"type":"settings","settings":{"signature":false}}\nEVENT {"type":"approve","index":99}\n' }
    return { value: { code: 0, signal: null } }
  })
  on('http.fetch', ($, e) => {
    if (!String(e.url).startsWith('http://127.0.0.1')) return { value: { status: 404, ok: false, headers: {}, text: '' } }
    pushed.push({ url: e.url, token: e.init?.headers?.['X-Meme-Token'], body: JSON.parse(e.init?.body ?? '{}') })
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  await ui.press({ key: 'view' })
  for (let i = 0; i < 40 && !log.calls.some((c) => c.tool === `${SLACK}slack_complete_file_upload`); i++) {
    await clock.settle()
    await new Promise((r) => setTimeout(r, 20))
  }

  const opened = log.ran.find((argv) => argv[0] === 'open')
  expect(opened?.[1]).toMatch(/^http:\/\/127\.0\.0\.1:5555\/#t=[0-9a-f]{48}&tab=drafts$/)
  const token = opened![1].split('#t=')[1].split('&')[0]
  expect(spawned[0].argv.join(' ')).not.toContain(token)
  expect(spawned[0].input).toBe(`${token}\n${GALLERY_EVENTS.join(",")}\nhttps://api.memegen.link\n`)
  const states = pushed.filter((p) => p.url === 'http://127.0.0.1:5555/api/state')
  const pickers = pushed.filter((p) => p.url === 'http://127.0.0.1:5555/api/templates')
  expect(states.length + pickers.length).toBe(pushed.length)
  expect(pushed.every((p) => p.token === token)).toBe(true)
  expect(JSON.stringify(pushed)).not.toContain('/Users/test')
  // The meme picker goes once, on its own; the state the page polls for never carries it.
  expect(pickers).toHaveLength(1)
  expect(pickers[0].body.templates.some((t) => t.id === 'drake')).toBe(true)
  expect(states.every((p) => !('templates' in p.body) && p.body.templatesVersion === pickers[0].body.version)).toBe(true)

  expect(log.calls.find((c) => c.tool === `${SLACK}slack_complete_file_upload`)).toMatchObject({ channel_id: 'C0C524GFGCF' })
  // The fake server ends after its script, so the mod stops pushing: read the outcome from the panel
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: '✓ Posted to #all-maughanco on Slack' })).toBeDefined()
  const last = states.at(-1).body
  expect(last).toMatchObject({ status: 'approved', approved: { template_name: 'Change My Mind' } })
  expect(last.slackChannels.map((c) => c.name)).toEqual(['all-maughanco', 'social'])
  expect(pushed.some((p) => p.body.settings?.signature === false)).toBe(true)
})

test('the gallery gets the meme picker once, apart from the state it polls for, and a refused push is logged', async ($, on) => {
  const pushed: any[] = []
  const { clock } = factory(on)
  let refuse = false
  // The page's actions change the settings, so the mod pushes the state again; the last push goes
  // to a server that refuses it.
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: 'READY 5555\n' }
    yield { stream: 'stdout', text: 'EVENT {"type":"settings","settings":{"signature":false}}\n' }
    yield { stream: 'stdout', text: 'EVENT {"type":"settings","settings":{"signature":true}}\n' }
    refuse = true
    yield { stream: 'stdout', text: 'EVENT {"type":"settings","settings":{"signature":false}}\n' }
    return { value: { code: 0, signal: null } }
  })
  on('http.fetch', ($, e) => {
    if (!String(e.url).startsWith('http://127.0.0.1')) return { value: { status: 404, ok: false, headers: {}, text: '' } }
    pushed.push({ url: String(e.url), body: JSON.parse(e.init?.body ?? '{}') })
    return refuse && String(e.url).endsWith('/api/state') ? { value: { status: 400, ok: false, headers: {}, text: '' } } : { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'meme', args: 'gallery' })
  for (let i = 0; i < 20; i++) await clock.settle()
  const pickers = pushed.filter((p) => p.url.endsWith('/api/templates'))
  const states = pushed.filter((p) => p.url.endsWith('/api/state'))
  expect(pickers).toHaveLength(1)
  expect(pickers[0].body.templates.some((t) => t.id === 'drake')).toBe(true)
  expect(states.length).toBeGreaterThan(2)
  expect(states.every((p) => !('templates' in p.body) && p.body.templatesVersion === pickers[0].body.version)).toBe(true)
  const report = JSON.parse((await $.tool.call({ tool: 'mcp__meme-factory__meme_factory_debug', tool_use_id: 'd1', action: 'status' })).result)
  expect(report.log.some((l) => l.includes('gallery: /api/state refused (400)'))).toBe(true)
})

test("with the whole catalog the gallery's state stays small, and the picker's version changes with the catalog", () => {
  // A few more templates than the server adds. The picker alone is then far over the
  // gallery server's 256 KB limit for a state, which used to refuse every push.
  const bulk = Array.from({ length: 1400 }, (_, i) => ({ id: `bulk-${i}`, name: `Bulk ${i.toString(36)} ${(i * 7919).toString(36)} meme`, lines: 2, shape: 'reaction', core: 'x', slots: ['', ''], aliases: [`bulk ${i}`], example: ['', ''], rank: 500 + i }))
  const before = pickerTemplates().version
  expect(addTemplates(bulk)).toBe(1400)
  const picker = pickerTemplates()
  expect(picker.version).not.toBe(before)
  expect(picker.templates.length).toBeGreaterThan(1400)
  expect(JSON.stringify(picker).length).toBeGreaterThan(256 * 1024)
  const job = { status: 'review', stage: '', drafts: [], selected: 0, approved: null, chat: [], note: '', error: '', request: '' }
  const state = galleryState(job, { slack: null, channels: [], others: [] }, {})
  expect('templates' in state).toBe(false)
  expect(state.templatesVersion).toBe(picker.version)
  expect(JSON.stringify(state).length).toBeLessThan(16 * 1024)
  removeTemplates(bulk.map((t) => t.id))
  expect(pickerTemplates().version).not.toBe(picker.version)
})

test('/meme settings opens the gallery on its Settings tab', async ($, on) => {
  const { log } = factory(on)
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: 'READY 6000\n' }
    return { value: { code: 0, signal: null } }
  })
  on('http.fetch', () => ({ value: { status: 204, ok: true, headers: {}, text: '' } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const answer = await $.command.run({ command: 'meme', args: 'settings' })
  expect(answer.text).toMatch(/gallery/)
  expect(log.ran.find((argv) => argv[0] === 'open')?.[1]).toMatch(/:6000\/#t=[0-9a-f]+&tab=settings$/)
})

test('ask-before-posting holds a connector call Claude makes with a meme link', async ($, on) => {
  const { log } = factory(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const meme = { tool: 'mcp__gm41l__send_message', tool_use_id: 't2', to: 'a@b.co', body: 'lol https://api.memegen.link/images/fine/_/this_is_fine.png' }
  expect(await $.tool.call(meme)).toEqual({ result: 'sent' })
  expect(log.asked[0]).toMatch(/let Claude post this meme with send_message/)
  // Ordinary connector calls and Claude's own tools are never held
  expect(await $.tool.call({ tool: 'mcp__gm41l__send_message', tool_use_id: 't4', body: 'hello' })).toEqual({ result: 'sent' })
  expect(await $.tool.call({ tool: 'Bash', tool_use_id: 't5', command: 'echo https://api.memegen.link/images/x.png' })).toEqual({ result: 'sent' })
  expect(log.asked.length).toBe(1)
})

test('a terminal without inline images gets a one-line note, not an empty image box', async ($, on) => {
  const { clock } = factory(on, { termProgram: 'Apple_Terminal' })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /^No preview in this terminal/ })).toBeDefined()
  expect(await ui.find({ key: 'approve' })).toBeDefined()
})

test('inline above the prompt: no picture, one caption line, the last reply only', async ($, on) => {
  const { clock } = factory(on, { chatReply: () => ({ reply: 'Picked draft 2.', action: { type: 'select', draft: 2 } }) })
  await draftsReady($, clock)
  const INLINE = { ...PANE, props: { ...PANE.props, placement: 'inline', scroll: { offset: 0, bodyRows: 6 } } } as const
  const ui = await $.ui.mount({ ...INLINE, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'async updates / everyone reads their Jira tickets aloud' })).toBeDefined()
  await ui.input({ key: 'chat', text: 'use 2' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'Picked draft 2.' })).toBeDefined()
  // Inline shows the factory's last reply, not your own line
  expect(await ui.find({ type: 'Text', text: 'use 2' })).toBeUndefined()
})

test("Claude's meme in a narrow terminal shows above the prompt, until you open the panel", async ($, on) => {
  const { clock } = factory(on, { narrow: true })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: ['the engine band'] }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  // Before any meme, the band is left to the engine.
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ type: 'Text', text: 'the engine band' })).toBeDefined()
  await $.tool.call({ tool: TOOL, tool_use_id: 't1', request: 'standups that run long' })
  expect(await band.find({ type: 'Text', text: /Writing captions/ })).toBeDefined()
  await clock.settle()
  expect(await band.find({ key: 'approve' })).toBeDefined()
  expect(await band.find({ type: 'Image' })).toBeUndefined()
  const report = JSON.parse((await $.tool.call({ tool: 'mcp__meme-factory__meme_factory_debug', tool_use_id: 'd1', action: 'status' })).result)
  expect(report).toMatchObject({ pane: { isPlaced: false }, inBand: true })
  // You open it, with /meme or the band's button: the pane is placed at any width, and the band steps aside.
  await $.command.run({ command: 'meme', args: '' })
  expect(await band.find({ key: 'approve' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: 'the engine band' })).toBeDefined()
})

test("the band's Open the panel button opens the pane as yours, so it's placed", async ($, on) => {
  const { clock } = factory(on, { narrow: true })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => $.ui.resolve(e).Text({ children: ['the engine band'] }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.tool.call({ tool: TOOL, tool_use_id: 't1', request: 'standups that run long' })
  await clock.settle()
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await band.press({ key: 'open-pane' })
  expect(await band.find({ type: 'Text', text: 'the engine band' })).toBeDefined()
  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await pane.find({ key: 'approve' })).toBeDefined()
  // The docked pane has no such button: it is already open.
  expect(await pane.find({ key: 'open-pane' })).toBeUndefined()
})

test('sending in the chat box returns at once, so Claude Code clears the field', async ($, on) => {
  // A slow chat reply: Claude Code empties the field only once the send returns.
  const { clock } = factory(on, { chatDelay: 5000 })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const sent = ui.input({ key: 'chat', text: 'meaner please' }).then(() => 'returned')
  expect(await Promise.race([sent, new Promise((r) => setTimeout(r, 300, 'held'))])).toBe('returned')
  await clock.advance(5000)
  await clock.settle()
})

test("a place the mod can't post to itself is confirmed in the panel, then its poster starts in the background; nothing reaches the conversation", async ($, on) => {
  const spawned: any[] = []
  on('agent.spawn', ($, e) => {
    spawned.push(e)
    return { model: 'sonnet' }
  })
  const { clock, log } = factory(on, { chatReply: () => ({ reply: 'Posting it.', action: { type: 'post', destination: '#trustai-platform-team on Slack' } }) })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'chat', text: 'approve it and post it to #trustai-platform-team on Slack' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'Post to #trustai-platform-team on Slack?' })).toBeDefined()
  expect(spawned.some((s) => s.subagent_type === 'meme-factory:poster')).toBe(false)
  await ui.press({ key: 'confirm' })
  await clock.settle()
  const job = spawned.find((s) => s.subagent_type === 'meme-factory:poster')
  expect(job?.prompt).toContain('"#trustai-platform-team on Slack"')
  // Its hooks read which meme it may post, and the post it makes, from these two files.
  const url = String(job?.prompt).match(/Meme image URL: (\S+)/)![1]
  expect(log.written.find((w) => w.path.endsWith('-path'))?.text).toBe(memePath(url))
  expect(log.written.find((w) => w.path.endsWith('-posted'))?.text).toBe('')
  expect(job?.prompt).toMatch(/Meme image URL: https:\/\/api\.memegen\.link\/images\//)
  expect(log.submitted).toEqual([])
  // No agent runs in the test kit (it sets no agentId), so the panel says the helper didn't start.
  expect(await ui.find({ type: 'Text', text: /Couldn't post to #trustai-platform-team on Slack: the posting helper didn't start/ })).toBeDefined()
  expect(await ui.find({ key: 'retry-post' })).toBeDefined()
})

test("the poster's own hooks: connectors only, one post, only this meme, recorded for the mod; and its word is checked against what it did", () => {
  const hooks = posterHooks('/Users/me/.cache/meme-factory/poster-s1')!
  const [pre] = hooks.PreToolUse
  const [post] = hooks.PostToolUse
  // Every call the poster makes is decided here (a mod's tool.call hooks never see a subagent's calls).
  expect(pre.matcher).toBe('*')
  const before = pre.hooks[0].command
  expect(before).toContain('ToolSearch) printf')
  expect(before).toContain('mcp__meme-factory__*) printf')
  expect(before).toContain('"permissionDecision":"deny","permissionDecisionReason":"The Meme Factory poster only uses connectors."')
  expect(before).toContain("p=$(cat '/Users/me/.cache/meme-factory/poster-s1-path' 2>/dev/null)")
  expect(before).toContain("grep -qF -- \"$p\"")
  expect(before).toContain("if [ -s '/Users/me/.cache/meme-factory/poster-s1-posted' ]")
  expect(before).toContain('*_send_*|*_post_*|*_create_*')
  // A post that went through is written down for the mod.
  expect(post.matcher).toBe('mcp__.*')
  expect(post.hooks[0].command).toContain("printf '%s' \"$i\" > '/Users/me/.cache/meme-factory/poster-s1-posted'")
  // A folder name the shell can't hold safely gets no hooks, and the mod won't post unguarded.
  expect(posterHooks("/Users/o'brien/.cache/meme-factory/poster-s1")).toBeUndefined()

  const said = JSON.stringify({ posted: true, where: '#x on Slack', link: 'https://provar.slack.com/archives/C1/p1' })
  expect(posterOutcome(said, true)).toEqual({ posted: true, where: '#x on Slack', link: 'https://provar.slack.com/archives/C1/p1' })
  expect(posterOutcome(said, false).reason).toMatch(/said it posted, but it didn't/)
  expect(posterOutcome('not json at all', true)).toEqual({ posted: true, where: '', link: null })
  expect(posterOutcome(JSON.stringify({ posted: false, reason: 'No channel by that name' }), false)).toEqual({ posted: false, reason: 'No channel by that name' })
  expect(parsePosted(JSON.stringify({ posted: true, link: 'javascript:alert(1)' })).link).toBeNull()

  const prompt = posterPrompt(makeDraft('db', ['Meme Factory', 'Me', 'Real work'], 5)!, '#x on Slack', true)
  expect(prompt).toContain('Where (the person\'s words): "#x on Slack"')
  expect(prompt).toContain('Fresh from the [Meme Factory](https://github.com/CodyAMaughan/meme-factory) 🏭')
})

test("the mod's own helpers don't hand back into the conversation: their reports are dropped, and nothing else", () => {
  // The shape Claude Code 2.1.295 used for the picture check's hand-back.
  const id = 'ac66173620b500af8'
  const handback = {
    origin: { kind: 'peer', from: id, senderTaskId: id, name: 'meme-factory:picture-check', handback: true },
    text: `Another Claude session sent a message:\n<agent-message from="${id}">\n[Subagent hand-back] The report follows:\n  {"checks":[]}\n</agent-message>`,
  }
  expect(ownHandback(handback, new Set([id]))).toBe(id)
  expect(ownHandback({ ...handback, origin: { kind: 'peer' } }, new Set([id]))).toBe(id)
  expect(ownHandback(handback, new Set(['another-agent']))).toBe('')
  // What you type, and other sessions' messages, always go through.
  expect(ownHandback({ origin: { kind: 'composer' }, text: `look at from="${id}"` }, new Set([id]))).toBe('')
  expect(ownHandback({ origin: { kind: 'peer', from: 'someone' }, text: 'hi' }, new Set([id]))).toBe('')
})

test('after approving, t still reaches the chat box (the post view says "Say: post it to…")', async ($, on) => {
  const { clock } = factory(on)
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /Approved/ })).toBeDefined()
  expect(await ui.find({ key: 'talk' })).toMatchObject({ props: { hotkey: 't' } })
})

test("the chat box knows Slack is there when a helper posts to it, so it doesn't say Slack isn't connected", () => {
  const job = { request: 'r', status: 'approved', approved: { template_name: 'X' }, drafts: [], selected: 0, chat: [] }
  const withHelper = chatPrompt(job, [], [], 'post it to #team', ['Slack', 'Email'])
  expect(withHelper).toContain('Slack channels: (Slack is connected: a #channel the person names is found when posting)')
  expect(withHelper).toContain('Other places a helper can post to: Slack, Email')
  expect(chatPrompt(job, [], [], 'post it to #team')).toContain('Slack channels: (Slack not connected)')
})

test("the header is something to click in the terminal: a button that does nothing but take the keyboard", async ($, on) => {
  // Where the ring goes (out of Say after a click or a send) is verified in a real session: the test
  // kit has no focus ring, and $.ui.focus reaches no hook here.
  const { clock } = factory(on)
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const header = await ui.find({ key: 'header' })
  expect(header).toMatchObject({ type: 'Button', props: { plain: true } })
  expect(header?.props).not.toHaveProperty('hotkey')
  expect(await ui.find({ type: 'Text', text: 'standups that run long' })).toBeDefined()
  await ui.press({ key: 'header' })
  expect(await ui.find({ key: 'approve' })).toBeDefined()
  // Desktop draws the wordmark as an image, which no Button can hold: no header button there.
  const desktop = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await desktop.find({ key: 'header' })).toBeUndefined()
})

test('a new meme starts a new chat: New, a meme from Claude, and "new meme about…" in the chat box', async ($, on) => {
  let next: object = { reply: 'Meaner coming up.', action: { type: 'none' } }
  const { clock } = factory(on, { chatReply: () => next })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'chat', text: 'meaner please' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'Meaner coming up.' })).toBeDefined()
  // New, then the next meme's drafts: the old chat doesn't come back.
  await ui.press({ key: 'new' })
  await ui.input({ key: 'chat', text: 'standups that run long' })
  await clock.settle()
  expect(await ui.find({ key: 'approve' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'meaner please' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'Meaner coming up.' })).toBeUndefined()

  // A meme Claude asks for starts a fresh chat too.
  await ui.input({ key: 'chat', text: 'meaner please' })
  await clock.settle()
  await $.tool.call({ tool: TOOL, tool_use_id: 't2', request: 'flaky tests' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'Meaner coming up.' })).toBeUndefined()

  // Asked for in the chat box, the new meme's chat opens with the exchange that asked for it.
  await ui.input({ key: 'chat', text: 'meaner please' })
  await clock.settle()
  next = { reply: 'Starting a meme about cats.', action: { type: 'new', request: 'cats' } }
  await ui.input({ key: 'chat', text: 'new meme about cats' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'Starting a meme about cats.' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'new meme about cats' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Meaner coming up.' })).toBeUndefined()
})

test('Desktop draws the meme as an SVG with a link to the full image', async ($, on) => {
  const { clock } = factory(on)
  await draftsReady($, clock, 'desktop')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // The first Svg is the brand mark, the same wordmark the repo and gallery use.
  expect((await ui.find({ type: 'Svg' }))?.props.alt).toBe('Meme Factory')
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Link' })).toMatchObject({ props: { label: 'Open full image' } })
})

test('the empty panel takes a meme request in the chat box', async ($, on) => {
  const { clock } = factory(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'meme', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'chat', text: 'cats on keyboards' })
  await clock.settle()
  expect(await ui.find({ key: 'approve' })).toBeDefined()
})

test('helpers: memegen URLs, JSON in fences, ranking, PNG sizing, connectors, destinations', async () => {
  expect(encodeLine('why not both?')).toBe('why_not_both~q')
  expect(encodeLine('50% off & free-ish')).toBe('50~p_off_~a_free--ish')
  expect(encodeLine('')).toBe('_')
  expect(memeUrl('drake', ['a', 'b'])).toBe('https://api.memegen.link/images/drake/a/b.png')
  expect(parseJson('Sure!\n```json\n{"a":1}\n```')).toEqual({ a: 1 })
  const ranked = topDrafts([
    { id: '1', template_id: 'x', score: 9 },
    { id: '2', template_id: 'x', score: 8 },
    { id: '3', template_id: 'y', score: 1 },
  ] as any, 2)
  expect(ranked.map((d) => d.id)).toEqual(['1', '3'])
  expect(pngSize(pngHeader(600, 400))).toEqual({ width: 600, height: 400 })
  expect(imageCells({ width: 600, height: 400 }, 56)).toEqual({ columns: 56, rows: 19 })
  // Too tall for the room: it narrows so the rows fit, keeping its shape
  expect(imageCells({ width: 600, height: 600 }, 56, 10)).toEqual({ columns: 20, rows: 10 })
  expect(shortName('Distracted Boyfriend')).toBe('Distracted')
  expect(shortName('Drakeposting')).toBe('Drakeposting')

  const found = postingConnectors([
    { name: 'mcp__s__slack_send_message', description: '', mcp: true },
    { name: 'mcp__s__slack_list_user_channels', description: '', mcp: true },
    { name: 'mcp__m__chat_message_search', description: 'Search Microsoft Teams chats', mcp: true },
  ])
  expect(found).toEqual({ slack: { prefix: 'mcp__s__', canUpload: false }, others: [] })
  // Slack's own plugin can't list channels or upload, so Claude posts there; it mentions email but is Slack.
  const pluginSlack = [
    { name: 'mcp__plugin_slack_slack__slack_send_message', description: 'Sends a message to a Slack channel or user.', mcp: true },
    { name: 'mcp__plugin_slack_slack__slack_search_channels', description: 'Search for Slack channels.', mcp: true },
    { name: 'mcp__plugin_slack_slack__slack_search_users', description: 'Search for Slack users by name, email, or profile attributes.', mcp: true },
  ]
  expect(postingConnectors([...pluginSlack, { name: 'mcp__gm41l__send_message', description: 'Send a Gmail email', mcp: true }])).toEqual({ slack: null, others: ['Slack', 'Email'] })
  expect(postingConnectors(pluginSlack)).toEqual({ slack: null, others: ['Slack'] })
  // With a Slack the mod posts to itself, the other isn't offered twice.
  expect(postingConnectors([...pluginSlack, { name: 'mcp__s__slack_send_message', mcp: true }, { name: 'mcp__s__slack_list_user_channels', mcp: true }]).others).toEqual([])

  const channels = [{ id: 'C1', name: 'all-maughanco' }, { id: 'C2', name: 'social' }]
  expect(resolveDestination('post it to #social', channels, [])).toEqual({ kind: 'slack', id: 'C2', name: 'social' })
  expect(resolveDestination('socialize it on LinkedIn', channels, [])).toEqual({ kind: 'claude', target: 'socialize it on LinkedIn' })
  expect(resolveDestination('team memes', channels, [{ label: 'Team memes', target: '#all-maughanco', channelId: 'C1', channelName: 'all-maughanco' }])).toEqual({ kind: 'slack', id: 'C1', name: 'all-maughanco' })
})


test('helpers hold up against odd input: dot-only lines, junk scores, look-alike destinations', async () => {
  // A dot-only line can't become a "." or ".." path segment.
  expect(encodeLine('..')).not.toMatch(/^\.+$/)
  expect(memeUrl('drake', ['.', 'b'])).not.toContain('/./')
  // A score the judge didn't give as a number keeps the old one.
  const [d] = applyScores([{ id: 'x', score: 5 }] as any, JSON.stringify({ scores: [{ i: 0, score: 'high' }] }))
  expect(d.score).toBe(5)
  // Names match as whole words, and an explicit #channel beats a favorite.
  const channels = [{ id: 'C1', name: 'social' }, { id: 'C2', name: 'devops' }]
  const favorites = [{ label: '#dev', target: '#dev on Slack', channelId: 'C9', channelName: 'dev' }, { label: 'X', target: 'my X account' }]
  expect(resolveDestination('post to #devops', channels, favorites)).toEqual({ kind: 'slack', id: 'C2', name: 'devops' })
  expect(resolveDestination('post it to #exec-team', channels, favorites)).toEqual({ kind: 'claude', target: 'post it to #exec-team' })
  expect(resolveDestination('post on x', channels, favorites)).toEqual({ kind: 'claude', target: 'my X account' })
  expect(resolveDestination('#dev please', channels, favorites)).toEqual({ kind: 'slack', id: 'C9', name: 'dev' })
  // Images that are too tall narrow to fit the rows they have.
  expect(imageCells({ width: 600, height: 600 }, 56, 10)).toEqual({ columns: 20, rows: 10 })
})

test('naming a template in plain words gets it drafted, from the request or the chat box', async ($, on) => {
  expect(templatesNamed('use kombucha girl')).toEqual(['kombucha'])
  expect(templatesNamed('the woman yelling at a cat')).toEqual(['woman-cat'])
  expect(templatesNamed('make it a drake meme')).toEqual(['drake'])
  // Ordinary words that happen to be template ids don't count.
  expect(templatesNamed('success! tests pass, money well spent')).toEqual([])
  expect(templatesNamed('my wife thinks I am weird')).toEqual([])

  let next: object = { reply: 'Kombucha Girl it is.', action: { type: 'remix', feedback: 'use kombucha girl' } }
  const { clock, log } = factory(on, { chatReply: () => next })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'chat', text: 'use kombucha girl' })
  await clock.settle()
  expect(log.prompts.some((p) => /Use exactly these templates: kombucha \(Kombucha Girl/.test(p))).toBe(true)
})

test('"More like this" drafts three takes on the one meme shown', async ($, on) => {
  const { clock, log } = factory(on)
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'more' })
  await clock.settle()
  const last = String(log.prompts.filter((p) => String(p).includes('"shape"')).at(-1))
  expect(last).toMatch(/Use only drake \(Drakeposting/)
  expect(last).toContain('Write 6 candidates')
})

test('the chat box can set a caption word for word, with nothing rewritten', async ($, on) => {
  const { clock } = factory(on, { chatReply: () => ({ reply: 'Done.', action: { type: 'edit', draft: 1, lines: ['me: one more mod', 'my wife:'] } }) })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'chat', text: 'make it say "me: one more mod" and "my wife:"' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'me: one more mod' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'my wife:' })).toBeDefined()
})

test('quoted words reach the writer and the judge verbatim', async ($, on) => {
  const { clock, log } = factory(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.tool.call({ tool: TOOL, tool_use_id: 't9', request: 'my wife watching me make memes, bottom line "it\'s for work"' })
  await clock.settle()
  const all = log.prompts.map(String)
  expect(all.some((p) => p.includes('The user\'s exact words (use verbatim): "it\'s for work"'))).toBe(true)
  expect(all.some((p) => p.includes('must appear unchanged: "it\'s for work"'))).toBe(true)
})

test('one-liners: long captions are filtered, a face box stays short, and custom templates render', async () => {
  expect(quotedText('say "this is fine" and “ok”')).toEqual(['this is fine', 'ok'])
  expect(fitsBudget({ template_id: 'drake', lines: ['tests', 'vibes'] } as any)).toBe(true)
  expect(fitsBudget({ template_id: 'drake', lines: ['one two three four five six seven eight nine', 'x'] } as any)).toBe(false)
  // The top box of Interesting Man covers his face: keep it to a few words.
  expect(fitsBudget({ template_id: 'interesting', lines: ['when the build finally passes after all', 'i ship'] } as any)).toBe(false)
  // The person's own words never count against the budget.
  expect(fitsBudget({ template_id: 'drake', lines: ['one two three four five six seven eight nine', 'x'] } as any, ['one two three four five six seven eight nine'])).toBe(true)
  expect(memeUrl('chloe', ['me: hi', 'her:'])).toMatch(/^https:\/\/api\.memegen\.link\/images\/custom\/me%3A_hi\/her%3A\.png\?background=https%3A%2F%2Fraw\.githubusercontent\.com/)
  expect(templatesNamed('the little girl side eye')).toEqual(['chloe'])
})

test('models: Opus writes and Sonnet judges by default', async ($, on) => {
  const { clock, log } = factory(on)
  await draftsReady($, clock)
  expect(log.models.find((m) => m.system.includes('writer'))?.model).toBe('opus')
  expect(log.models.find((m) => m.system.includes('judge'))?.model).toBe('sonnet')
})

test('models: the Fast setting drafts with Sonnet', async ($, on) => {
  const { clock, log } = factory(on, { settings: { askBeforePost: true, signature: true, quality: 'fast', favorites: [] } })
  await draftsReady($, clock)
  expect(log.models.find((m) => m.system.includes('writer'))?.model).toBe('sonnet')
})

test('the picture check is spawned on the rendered drafts, and its fixes apply', async ($, on) => {
  const spawned: any[] = []
  on('agent.register', () => ({ value: { agent: 'meme-factory:picture-check' } }))
  on('agent.spawn', ($, e) => {
    spawned.push(e)
    return { model: 'sonnet' }
  })
  const { clock } = factory(on, { settings: { askBeforePost: true, signature: true, checkPictures: true, favorites: [] } })
  await draftsReady($, clock)
  // The helper is spawned with the cached pictures to look at.
  expect(spawned[0]?.subagent_type).toBe('meme-factory:picture-check')
  expect(String(spawned[0]?.prompt)).toMatch(/\/Users\/test\/\.cache\/meme-factory\/.*\.png/)
  // Its answer: shorten box 2 of draft 0, move draft 1's text above the picture, and junk.
  const fixes = parseReview(JSON.stringify({ checks: [
    { i: 0, problems: [{ box: 2, kind: 'tiny', fix: 'shorten', shorter: 'jira, aloud' }] },
    { i: 1, problems: [{ box: 1, kind: 'covers', fix: 'top' }] },
    { i: 2, problems: [{ box: 9, fix: 'shorten' }, 'junk'] },
  ] }))
  expect([...fixes.keys()]).toEqual([0, 1])
  const d0 = applyReview(makeDraft('drake', ['async updates', 'everyone reads their Jira tickets aloud'], 7)!, fixes.get(0)!)
  expect(d0?.lines).toEqual(['async updates', 'jira, aloud'])
  const d1 = applyReview(makeDraft('fine', ['', 'this is fine'], 6)!, fixes.get(1)!)
  expect(d1?.url).toContain('layout=top')
  // The person's own words are never shortened.
  expect(applyReview(makeDraft('drake', ['a', 'my exact long words here'], 5)!, [{ box: 1, kind: 'tiny', fix: 'shorten', shorter: 'short' }], ['my exact long words here'])).toBeNull()
})

test('a named meme survives the one-liner filter: its shortest draft is kept', async () => {
  const long = makeDraft('db', ['writing Claude Code mods at night', 'me', 'my actual job'], 5)!
  const longer = makeDraft('db', ['writing Claude Code mods every single night', 'me', 'my actual job'], 6)!
  const drake = makeDraft('drake', ['my job', 'mods'], 4)!
  expect(keepShort([long, longer, drake], [], []).map((d) => d.template_id)).toEqual(['drake'])
  expect(keepShort([long, longer, drake], [], ['db']).map((d) => d.id)).toEqual([drake.id, long.id])
})

test('the gallery picker: a meme picked first is used for the next one, and in review it drafts three takes', async ($, on) => {
  const { clock, log } = factory(on)
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: 'READY 5555\nEVENT {"type":"useTemplate","id":"chloe"}\nEVENT {"type":"useTemplate","id":"not-a-meme"}\n' }
    return { value: { code: 0, signal: null } }
  })
  on('http.fetch', () => ({ value: { status: 204, ok: true, headers: {}, text: '' } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'meme', args: 'gallery' })
  for (let i = 0; i < 20; i++) await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: 'Next meme uses Side-Eyeing Chloe' })).toBeDefined()
  await ui.input({ key: 'chat', text: 'my wife watching me build mods' })
  await clock.settle()
  const writer = String(log.prompts.filter((p) => String(p).includes('"shape"')).at(-1))
  expect(writer).toMatch(/Use only chloe \(Side-Eyeing Chloe/)
})

test("the picture check approves its own reads: only Read, only inside the cache, never with '..'", () => {
  const hook = readCacheHook('/Users/me/.cache/meme-factory')
  const [entry] = hook.PreToolUse
  expect(entry.matcher).toBe('Read')
  const { command } = entry.hooks[0]
  expect(command).toContain(`*'"file_path":"/Users/me/.cache/meme-factory/'*`)
  expect(command).toContain('*..*) ;;')
  expect(command).toContain('"permissionDecision":"allow"')
  // A folder name the shell pattern can't hold safely gets no hook at all.
  expect(readCacheHook("/Users/o'brien/.cache/meme-factory")).toBeUndefined()
})

test('ask-before-posting knows the mod’s memes on a self-hosted memegen server', () => {
  const path = memePath('https://api.memegen.link/images/drake/tests/demos.png?width=800')
  expect(path).toBe('/images/drake/tests/demos')
  const post = (text) => ({ tool: 'mcp__slack__post_message', channel: '#dev', text })
  expect(isMemePost(post('https://memes.example.com/images/drake/tests/demos.jpg'), [path])).toBe(true)
  expect(isMemePost(post('https://memes.example.com/images/drake/tests/demos.jpg'), [])).toBe(false)
  expect(isMemePost(post('https://api.memegen.link/images/fine/a/b.png'), [])).toBe(true)
  expect(isMemePost(post('lunch?'), [path])).toBe(false)
  expect(isMemePost({ tool: 'Bash', command: 'echo /images/drake/tests/demos' }, [path])).toBe(false)
})

test('MEMEGEN_URL and MEMEGEN_API_KEY: memes render on your own server, unwatermarked, and the key stays private', async ($, on) => {
  const { clock, log } = factory(on, { env: { MEMEGEN_URL: 'https://memes.maughanco.com/', MEMEGEN_API_KEY: 'sekrit-key' } })
  await draftsReady($, clock)
  const downloads = log.ran.map((argv, i) => ({ argv, stdin: log.stdins[i] })).filter((r) => r.argv[0] === 'curl' && r.argv.includes('-o'))
  expect(downloads.length > 0).toBe(true)
  for (const { argv, stdin } of downloads) {
    const url = argv.at(-1)!
    expect(url.startsWith('https://memes.maughanco.com/images/')).toBe(true)
    expect(url).toContain('watermark=none')
    // The key goes in a header read from stdin: never in the URL or the argument list
    expect(argv.join(' ')).not.toContain('sekrit-key')
    expect(argv).toContain('@-')
    expect(stdin).toBe('X-API-KEY: sekrit-key\n')
  }
  // The drafts' public URLs (what gets posted) point at your server and carry no key
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const link = await ui.find({ type: 'Link' })
  expect((link as any)?.props.href ?? '').not.toContain('sekrit')
})

test('with MEMEGEN_URL set to memegen.link, memes come from there with no key or watermark parameter', async ($, on) => {
  const { clock, log } = factory(on)
  await draftsReady($, clock)
  const downloads = log.ran.filter((argv) => argv[0] === 'curl' && argv.includes('-o'))
  expect(downloads.length > 0).toBe(true)
  for (const argv of downloads) {
    expect(argv.at(-1)!.startsWith('https://api.memegen.link/images/')).toBe(true)
    expect(argv.at(-1)).not.toContain('watermark=')
    expect(argv).not.toContain('@-')
  }
})

test('Slack still shows up when the desktop app leaves its tools out of the tool list', async ($, on) => {
  const { clock, log } = factory(on, { slackUnlisted: true })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  for (let i = 0; i < 5; i++) await clock.settle()
  expect(await ui.find({ key: 'ch-C0C5HB6PETU' })).toMatchObject({ props: { label: '#social' } })
  const slack = () => log.calls.filter((c) => c.server === 'claude.ai Slack')
  expect(slack()[0]).toMatchObject({ tool: 'mcp__claude.ai Slack__slack_list_user_channels' })
  await ui.press({ key: 'ch-C0C5HB6PETU' })
  await ui.press({ key: 'post' })
  await ui.press({ key: 'confirm' })
  for (let i = 0; i < 5; i++) await clock.settle()
  expect(slack().map((c) => c.tool.split('__').pop())).toEqual(['slack_list_user_channels', 'slack_get_file_upload_url', 'slack_complete_file_upload'])
  expect(slack().at(-1)).toMatchObject({ channel_id: 'C0C5HB6PETU' })
  expect(await ui.find({ type: 'Text', text: 'Posted to #social' })).toBeDefined()
})

test('compared and stacked memes ask for parallel boxes, and the judge rewards them', async () => {
  const rules = writerPrompt({ request: 'software factories vs meme factories' })[0].text
  expect(rules).toMatch(/7\. Parallel boxes/)
  expect(rules).toContain('"Software Factory" / "Meme Factory"')
  const judged = judgePrompt('software factories vs meme factories', [makeDraft('drake', ['Software Factory', 'Meme Factory'], 0)!])
  expect(judged).toContain('Drakeposting (shape binary-choice.')
  expect(judged).toMatch(/one word swapped, earn the full 3/)
})

test('a failed Slack lookup shows why in the panel, with ways forward, instead of no Slack', async ($, on) => {
  const { clock } = factory(on, { slackError: 'missing_scope' })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  for (let i = 0; i < 5; i++) await clock.settle()
  expect(await ui.find({ type: 'Text', text: /Slack is connected, but its channels didn't load: Slack answered slack_list_user_channels with an error: missing_scope/ })).toBeDefined()
  expect(await ui.find({ key: 'slack-retry' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /say "post it to #channel" in the chat/ })).toBeDefined()
  const report = JSON.parse((await $.tool.call({ tool: 'mcp__meme-factory__meme_factory_debug', tool_use_id: 'd1', action: 'status' })).result)
  expect(report.slack).toMatchObject({ via: 'tool list' })
  expect(report.channels).toEqual([])
  expect(report.slackProblem).toMatch(/missing_scope/)
  expect(report.log.some((l) => l.includes('slack channels failed'))).toBe(true)
})

test("auto mode can't block the mod's own Slack calls: they go to the server, not through Claude's tools", async ($, on) => {
  const { clock, log } = factory(on, { slackDenied: true })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  for (let i = 0; i < 5; i++) await clock.settle()
  await ui.press({ key: 'ch-C0C5HB6PETU' })
  await ui.press({ key: 'post' })
  await ui.press({ key: 'confirm' })
  for (let i = 0; i < 5; i++) await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'Posted to #social' })).toBeDefined()
  expect(log.calls.filter((c) => c.server === 'sl4ck').map((c) => c.tool.split('__').pop())).toEqual(['slack_list_user_channels', 'slack_get_file_upload_url', 'slack_complete_file_upload'])
  expect(log.calls.some((c) => !c.server && String(c.tool).startsWith(SLACK))).toBe(false)
})

test("when auto mode refuses the mod's direct Slack calls, they go through Slack's tools instead", async ($, on) => {
  const { clock, log } = factory(on, { mcpRefused: true })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  for (let i = 0; i < 5; i++) await clock.settle()
  expect(await ui.find({ key: 'ch-C0C5HB6PETU' })).toMatchObject({ props: { label: '#social' } })
  await ui.press({ key: 'ch-C0C5HB6PETU' })
  await ui.press({ key: 'post' })
  await ui.press({ key: 'confirm' })
  for (let i = 0; i < 5; i++) await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'Posted to #social' })).toBeDefined()
  expect(log.calls.filter((c) => String(c.tool).startsWith(SLACK)).map((c) => c.tool.slice(SLACK.length))).toEqual(['slack_list_user_channels', 'slack_get_file_upload_url', 'slack_complete_file_upload'])
})

test('when both routes are refused, the panel names the permission rule that lets the mod through', async ($, on) => {
  const { clock } = factory(on, { mcpRefused: true, slackDenied: true })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  for (let i = 0; i < 5; i++) await clock.settle()
  const note = await ui.find({ type: 'Text', text: /channels didn't load/ })
  expect(note).toBeDefined()
  const text = JSON.stringify(note)
  expect(text).toContain('permissions')
  for (const t of ['slack_list_user_channels', 'slack_get_file_upload_url', 'slack_complete_file_upload']) expect(text).toContain(`${SLACK}${t}`)
})

test('the self-approval hook leaves calls it did not make alone', async ($, on) => {
  const { clock } = factory(on)
  on('tool.check', () => ({ decision: 'ask' }))
  await draftsReady($, clock)
  expect((await $.tool.check({ tool: `${SLACK}slack_list_user_channels`, input: {} })).decision).toBe('ask')
})

test('desktop-shaped Slack replies (text wrapped as a JSON string) still give channels, an upload and a link', async ($, on) => {
  const { clock, log } = factory(on, { desktopShape: true })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  for (let i = 0; i < 5; i++) await clock.settle()
  expect(await ui.find({ key: 'ch-C0C5HB6PETU' })).toMatchObject({ props: { label: '#social' } })
  expect(await ui.find({ type: 'Text', text: /channels didn't load/ })).toBeUndefined()
  await ui.press({ key: 'ch-C0C5HB6PETU' })
  await ui.press({ key: 'post' })
  await ui.press({ key: 'confirm' })
  for (let i = 0; i < 5; i++) await clock.settle()
  expect(log.ran.find((argv) => argv.includes('--data-binary'))?.at(-1)).toBe('https://files.slack.com/upload/v1/ABC123')
  expect(await ui.find({ type: 'Text', text: 'Posted to #social' })).toBeDefined()
})

test('names that only differ in wording are the same meme', () => {
  expect(knownTemplate('Drake Blank')).toBe(true)
  expect(knownTemplate('Roll Safe Think About It')).toBe(true)
})

test("your memegen server's own templates join the catalog; the built-in ones aren't repeated", () => {
  const list = [{ id: 'drake', name: 'Drakeposting', lines: 2 }, { id: 'tradeoffer', name: 'Trade Offer', lines: 3 }, { id: '../x', name: 'Bad', lines: 2 }, { id: 'leftout', name: 'An Upstream One We Skip', lines: 2 }]
  const got = serverCandidates(list, undefined, [{ id: 'drake' }, { id: 'leftout' }])
  expect(got).toEqual([{ id: 'tradeoffer', name: 'Trade Offer', lines: 3, source: 'server' }])
})

test("a card the model can't write is skipped, not guessed; the rest are filled box by box", () => {
  const cands = [{ id: 'a', name: 'A', lines: 2, source: 'imgflip' }, { id: 'b', name: 'B', lines: 3, source: 'server' }]
  const cards = parseCards(JSON.stringify({ cards: [{ id: 'a', skip: true }, { id: 'b', shape: 'labeling', core: 'Three labels.', slots: ['one', 'two'], face: 'top', aliases: ['bee'], example: ['x', 'y', 'z'] }] }), cands)
  expect(cards).toHaveLength(1)
  expect(cards[0]).toMatchObject({ id: 'b', lines: 3, core: 'Three labels.', slots: ['one', 'two', ''], face: 'top', example: ['x', 'y', 'z'] })
  expect(parseCards('not json', cands)).toEqual([])
})

test("nothing is added from Imgflip's daily list, and cards an older version kept from it are dropped", async ($, on) => {
  const old = { id: 'imgflip-2kbn1e', name: 'Surprised Pikachu Two', lines: 2, background: 'https://i.imgflip.com/2kbn1e.jpg', source: 'imgflip', shape: 'reaction', core: 'Shock.', slots: ['', ''], aliases: [], example: ['', ''] }
  const { clock, log, saved } = factory(on, { serverTemplates: [], store: { moreTemplates: { version: 2, checked: 0, origin: 'https://api.memegen.link', cards: [old], skipped: {} } } })
  await draftsReady($, clock)
  expect(log.fetched).not.toContain('https://api.imgflip.com/get_memes')
  expect(log.prompts.some((p) => String(p).includes('imgflip-2kbn1e'))).toBe(false)
  expect(saved.get('moreTemplates').cards).toEqual([])
})

test('an added template renders over its own picture and can be asked for by name', () => {
  expect(addTemplates([{ id: 'imgflip-test1', name: 'Test Shocked Rodent', lines: 2, background: 'https://i.imgflip.com/test1.jpg', core: 'Shock.', slots: ['', ''], aliases: ['shocked rodent'], example: ['', ''], source: 'imgflip' }])).toBe(1)
  expect(addTemplates([{ id: 'imgflip-test1', name: 'Again', core: 'x' }])).toBe(0)
  expect(memeUrl('imgflip-test1', ['a', 'b'])).toBe('https://api.memegen.link/images/custom/a/b.png?background=https%3A%2F%2Fi.imgflip.com%2Ftest1.jpg')
  expect(templatesNamed('a shocked rodent meme')).toContain('imgflip-test1')
  expect(writerPrompt({ request: 'x' })[0].text).toContain('imgflip-test1 | Test Shocked Rodent')
})

test("templates you add to your own memegen server show up, with cards; memegen.link's own don't", async ($, on) => {
  const { clock, log, saved } = factory(on, {
    env: { MEMEGEN_URL: 'https://memes.example.com' },
    serverTemplates: [{ id: 'tradeoffer', name: 'Trade Offer', lines: 2 }, { id: 'drake', name: 'Drakeposting', lines: 2 }],
    cardsReply: { cards: [{ id: 'tradeoffer', shape: 'binary-choice', core: 'A lopsided deal.', slots: ['what I get', 'what you get'], aliases: ['trade offer'], example: ['', ''] }] },
  })
  await draftsReady($, clock)
  expect(log.fetched).toContain('https://memes.example.com/templates/')
  expect(saved.get('moreTemplates').cards).toMatchObject([{ id: 'tradeoffer', source: 'server', origin: 'https://memes.example.com' }])
  expect(log.prompts.some((p) => String(p).includes('tradeoffer | Trade Offer'))).toBe(true)
})

test('search: a rare matching word beats a common one, and popularity only decides between matches', () => {
  addTemplates([
    { id: 'rk-pika', name: 'Startled Rodent Zz', lines: 3, shape: 'reaction', core: 'Shock at an obvious outcome.', slots: ['', '', ''], aliases: ['zzshocked rodent'], example: ['', '', ''], rank: 900 },
    { id: 'rk-pika2', name: 'Startled Rodent Zz Two', lines: 2, shape: 'reaction', core: 'Shock at an obvious outcome.', slots: ['', ''], aliases: ['zzshocked rodent'], example: ['', ''], rank: 9 },
    { id: 'rk-famous', name: 'Extremely Famous Zz', lines: 2, shape: 'binary-choice', core: 'Choosing.', slots: ['', ''], aliases: [], example: ['', ''], rank: 1 },
  ])
  const got = rankTemplates('a zzshocked rodent meme', 5)
  expect(got.slice(0, 2)).toEqual(['rk-pika2', 'rk-pika'])
  // The most popular template of all, not a match, ranks below both matches.
  expect(got.indexOf('rk-famous') === -1 || got.indexOf('rk-famous') > 1).toBe(true)
  expect(popularity({ rank: 1 })).toBe(1)
  expect(popularity({ rank: 1 })).toBeGreaterThan(popularity({ rank: 500 }))
  expect(popularity({})).toBeGreaterThan(0)
})

test("the writer's shortlist: best matches, then the most popular all-rounders, and only those reach the prompt", () => {
  const ids = shortlistFor('a zzshocked rodent meme', { matches: 5, popular: 3 })
  expect(ids).toHaveLength(8)
  expect(ids).toContain('rk-pika2')
  expect(ids).toContain('rk-famous')
  const [rules, task] = writerPrompt({ request: 'x', shortlist: ids })
  expect(rules.cache).toBe(true)
  expect(rules.text).not.toContain('rk-')
  expect(task.text).toContain('rk-pika2 | Startled Rodent Zz Two')
  expect(task.text.split('\n').filter((l) => l.includes(' | ')).length).toBe(8)
})

test('a template taken back out leaves the catalog, the search and the writer', () => {
  addTemplates([{ id: 'rm-me', name: 'Zz Removable Meme', lines: 2, shape: 'reaction', core: 'x', slots: ['', ''], aliases: ['zzremovable'], example: ['', ''] }])
  expect(rankTemplates('zzremovable', 3)[0]).toBe('rm-me')
  expect(removeTemplates(['rm-me'])).toBe(1)
  expect(rankTemplates('zzremovable', 3)).not.toContain('rm-me')
  expect(writerPrompt({ request: 'x' })[0].text).not.toContain('rm-me')
  // Its name is free again, so the server's own version can join.
  expect(addTemplates([{ id: 'rm-me-2', name: 'Zz Removable Meme', lines: 2, shape: 'reaction', core: 'x', slots: ['', ''], aliases: [], example: ['', ''] }])).toBe(1)
})

test("with no MEMEGEN_URL, the Meme Factory's own server is used, asked with the client key", async ($, on) => {
  const { clock, log } = factory(on, { env: { MEMEGEN_URL: '' }, serverTemplates: [] })
  await draftsReady($, clock)
  expect(log.fetched).toContain('https://memegen-production-ff31.up.railway.app/templates/')
  const downloads = log.ran.filter((argv) => argv[0] === 'curl' && argv.includes('-o'))
  expect(downloads.every((argv) => argv.at(-1)!.startsWith('https://memegen-production-ff31.up.railway.app/images/'))).toBe(true)
})

test("if the Meme Factory's server is down, memes come from memegen.link instead", async ($, on) => {
  const { clock, log } = factory(on, { env: { MEMEGEN_URL: '' } })
  await draftsReady($, clock)
  const downloads = log.ran.filter((argv) => argv[0] === 'curl' && argv.includes('-o'))
  expect(downloads.length > 0).toBe(true)
  expect(downloads.every((argv) => argv.at(-1)!.startsWith('https://api.memegen.link/images/'))).toBe(true)
})

test('with a big catalog, a quick model finds the template: its rerank and catalog picks lead the writer\'s shortlist', async ($, on) => {
  const many = Array.from({ length: 300 }, (_, i) => {
    const n = String(i).padStart(3, '0')
    return { id: `big-${n}`, name: `Zz Big Template ${n}`, lines: 2, card: { shape: 'reaction', core: `Template number ${n}.`, slots: ['a', 'b'], aliases: [], rank: 100 + i } }
  })
  const { clock, log } = factory(on, { env: { MEMEGEN_URL: 'https://memes.example.com' }, serverTemplates: many })
  await draftsReady($, clock)
  expect(log.prompts.some((p) => String(p).includes('Describe the ideal meme template'))).toBe(true)
  expect(log.models.some((m) => m.model === 'haiku')).toBe(true)
  const writer = log.prompts.find((p) => String(p).includes('Meme request:') && String(p).includes('candidates'))
  const lines = String(writer).split('\n').filter((l) => /^[a-z0-9-]+ \| /.test(l))
  expect(lines[0].startsWith('big-042 |')).toBe(true)
  expect(lines[1].startsWith('big-007 |')).toBe(true)
  expect(lines.length).toBe(40)
})

test('the chat model decides about the pictures: "new" leaves the templates already shown, "same" keeps them, and "keep" holds the ones you like', async ($, on) => {
  // The words don't matter ("hmm, not feeling these" has none of the old trigger words): the model's call does.
  let next: object = { reply: 'New pictures coming.', action: { type: 'remix', feedback: 'hmm, not feeling these', pictures: 'new' } }
  const { clock, log } = factory(on, { chatReply: () => next })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const writerSince = (n: number, note: string) => log.prompts.slice(n).map(String).find((p) => p.includes(JSON.stringify(note)))!
  let n = log.prompts.length
  await ui.input({ key: 'chat', text: 'hmm, not feeling these' })
  await clock.settle()
  let writer = writerSince(n, 'hmm, not feeling these')
  expect(writer).not.toContain('Use exactly these templates')
  expect(writer).toMatch(/do not use [^\n]*drake/)
  expect(writer).toMatch(/do not use [^\n]*fine/)

  // "same": a note with the old trigger word "different" in it still keeps the pictures, because the model said so.
  next = { reply: 'On it.', action: { type: 'remix', feedback: 'a different tone, meaner', pictures: 'same' } }
  n = log.prompts.length
  await ui.input({ key: 'chat', text: 'a different tone, meaner' })
  await clock.settle()
  expect(writerSince(n, 'a different tone, meaner')).toContain('Use exactly these templates')

  // "keep": new memes, except draft 1's.
  next = { reply: 'Keeping the first.', action: { type: 'remix', feedback: 'keep the first, swap the rest', pictures: 'new', keep: [1] } }
  n = log.prompts.length
  await ui.input({ key: 'chat', text: 'keep the first, swap the rest' })
  await clock.settle()
  writer = writerSince(n, 'keep the first, swap the rest')
  expect(writer).toMatch(/The user asked for [^\n]*drake[^\n]* by name/i)
  expect(writer).not.toMatch(/do not use [^\n]*drake/)
  expect(writer).toMatch(/do not use [^\n]*fine/)
})
