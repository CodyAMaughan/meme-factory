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
  postingConnectors,
  resolveDestination,
  topDrafts,
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

const USAGE = { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

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
}

// Stubs everything the mod reaches: the model, the shell, files, the store, and three
// connectors: Slack (postable, uploads), Gmail (postable) and Microsoft 365 (Teams search only).
function factory(on, rig: Rig = {}) {
  const log = { ran: [] as string[][], submitted: [] as string[], copied: [] as string[], calls: [] as any[], asked: [] as string[], prompts: [] as string[] }
  const saved = new Map<string, unknown>(rig.settings ? [['settings', rig.settings]] : [])
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('env.get', ($, e) => ({ value: ({ HOME: '/Users/test', TERM_PROGRAM: rig.termProgram ?? 'ghostty' } as Record<string, string>)[e.name] }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', ($, e) => {
    log.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('session.surfaces', () => ({ value: ['terminal', 'desktop'] }))
  on('model.complete', ($, e) => {
    log.prompts.push(e.prompt)
    if (e.system.includes('judge')) return { value: { isAnswered: true, text: JUDGE_REPLY, usage: USAGE } }
    if (e.system.includes('chat box')) return { value: { isAnswered: true, text: JSON.stringify(rig.chatReply?.(e.prompt) ?? { reply: 'Hi!', action: { type: 'none' } }), usage: USAGE } }
    return { value: { isAnswered: true, text: WRITER_REPLY, usage: USAGE } }
  })
  on('process.run', ($, e) => {
    log.ran.push(e.argv)
    const isUpload = e.argv[0] === 'curl' && e.argv.includes('--data-binary')
    return { value: { exitCode: 0, stdout: isUpload ? 'OK - 323850' : '', stderr: '' } }
  })
  on('fs.read', ($, e) => ({ value: { base64: /\.png(\.part)?$/.test(e.path) ? pngHeader().toBase64() : 'SlBFRw==' } }))
  on('fs.exists', () => ({ value: true }))
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
    ],
  }))
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      log.asked.push(e.questions[0].question)
      return { result: { answers: { [e.questions[0].question]: 'Post it' } } }
    }
    log.calls.push(e)
    if (e.tool === `${SLACK}slack_list_user_channels`) return { result: CHANNELS_REPLY }
    if (e.tool === `${SLACK}slack_get_file_upload_url`) return { result: TICKET_REPLY }
    if (e.tool === `${SLACK}slack_complete_file_upload`) return { result: DONE_REPLY }
    return { result: 'sent' }
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
  expect(await review.find({ type: 'Text', text: ' MEME FACTORY ' })).toMatchObject({ props: { inverse: true } })
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

test('the chat box remixes, and hands places the mod cannot reach to Claude', async ($, on) => {
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
  expect(log.submitted.length).toBe(1)
  expect(log.submitted[0]).toContain('wants it posted to: my LinkedIn')
  expect(log.submitted[0]).toContain('Work out which connector')
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
  expect(spawned[0].input).toBe(`${token}\n${GALLERY_EVENTS.join(',')}\n`)
  expect(pushed.every((p) => p.url === 'http://127.0.0.1:5555/api/state' && p.token === token)).toBe(true)
  expect(JSON.stringify(pushed)).not.toContain('/Users/test')

  expect(log.calls.find((c) => c.tool === `${SLACK}slack_complete_file_upload`)).toMatchObject({ channel_id: 'C0C524GFGCF' })
  // The fake server ends after its script, so the mod stops pushing: read the outcome from the panel
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: '✓ Posted to #all-maughanco on Slack' })).toBeDefined()
  const last = pushed.at(-1).body
  expect(last).toMatchObject({ status: 'approved', approved: { template_name: 'Change My Mind' } })
  expect(last.slackChannels.map((c) => c.name)).toEqual(['all-maughanco', 'social'])
  expect(pushed.some((p) => p.body.settings?.signature === false)).toBe(true)
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

test('Desktop draws the meme as an SVG with a link to the full image', async ($, on) => {
  const { clock } = factory(on)
  await draftsReady($, clock, 'desktop')
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
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
