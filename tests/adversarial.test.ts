// Adversarial tests: each asserts the behavior the Meme Factory SHOULD have when the model,
// the connectors, the gallery page or the store misbehave. A failing test is a bug.
import { expect, mock, test } from 'claude-code/testing'
import { memeUrl } from '../hooks/lib.js'

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
const INLINE = { ...PANE, props: { ...PANE.props, placement: 'inline', scroll: { offset: 0, bodyRows: 6 } } } as const
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
// Drafts come out: 1 Drakeposting, 2 This is Fine, 3 Change My Mind
const JUDGE_REPLY = '{"scores":[{"i":0,"score":6},{"i":1,"score":9},{"i":2,"score":8},{"i":3,"score":2},{"i":4,"score":7},{"i":5,"score":3}]}'
const channelsReply = (chs: [string, string][]) =>
  `## My Channels\n\n${chs.map(([name, id]) => `### #${name}\n- **ID:** ${id}\n- **Type:** Public Channel\n`).join('\n')}`
const CHANNELS: [string, string][] = [
  ['all-maughanco', 'C0C524GFGCF'],
  ['social', 'C0C5HB6PETU'],
]
const TICKET_REPLY = 'File ID: F0TESTFILE1\nUpload URL: https:\\/\\/files.slack.com\\/upload\\/v1\\/ABC123\n'
const DONE_REPLY = JSON.stringify({ file_id: 'F0TESTFILE1', permalink: 'https://maughanco.slack.com/files/U0/F0TESTFILE1/x.png' })

function pngHeader(width = 600, height = 400): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const v = new DataView(bytes.buffer)
  v.setUint32(16, width)
  v.setUint32(20, height)
  return bytes
}

type Rig = {
  writer?: (prompt: string) => any // string, or a full model.complete value
  judge?: (prompt: string) => any
  chatReply?: (prompt: string) => any // object (JSON-encoded) or raw string
  writerDelay?: number // ms on the mock clock, for the 2nd+ writer call
  tool?: (e: any) => any // override a connector answer; undefined falls through
  run?: (argv: string[]) => any
  channels?: [string, string][]
  settings?: unknown
  store?: Record<string, unknown>
  png?: [number, number]
  completeDelay?: number // ms on the mock clock before complete_file_upload answers
}

function factory(on, rig: Rig = {}) {
  const log = { ran: [] as string[][], submitted: [] as string[], copied: [] as string[], calls: [] as any[], prompts: [] as string[], toasts: [] as string[] }
  const saved = new Map<string, unknown>(Object.entries(rig.store ?? {}))
  if (rig.settings !== undefined) saved.set('settings', rig.settings)
  const clock = mock.clock(on)
  let writes = 0
  on('session.start', () => ({ cwd: '/work' }))
  on('env.get', ($, e) => ({ value: ({ HOME: '/Users/test', TERM_PROGRAM: 'ghostty' } as Record<string, string>)[e.name] }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', ($, e) => {
    log.toasts.push(e.text ?? e.message ?? JSON.stringify(e))
    return { value: undefined }
  })
  on('ui.copy', ($, e) => {
    log.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('model.complete', async ($, e) => {
    log.prompts.push(e.prompt)
    const wrap = (v: any) => (typeof v === 'string' ? { isAnswered: true, text: v, usage: USAGE } : v)
    if (e.system.includes('judge')) return { value: wrap(rig.judge ? rig.judge(e.prompt) : JUDGE_REPLY) }
    if (e.system.includes('chat box')) {
      const r = rig.chatReply?.(e.prompt) ?? { reply: 'Hi!', action: { type: 'none' } }
      return { value: wrap(typeof r === 'string' ? r : JSON.stringify(r)) }
    }
    writes++
    if (writes > 1 && rig.writerDelay) await clock.sleep(rig.writerDelay)
    return { value: wrap(rig.writer ? rig.writer(e.prompt) : WRITER_REPLY) }
  })
  on('process.run', ($, e) => {
    log.ran.push(e.argv)
    const o = rig.run?.(e.argv)
    if (o) return { value: o }
    const isUpload = e.argv[0] === 'curl' && e.argv.includes('--data-binary')
    return { value: { exitCode: 0, stdout: isUpload ? 'OK - 323850' : '', stderr: '' } }
  })
  on('fs.read', ($, e) => ({ value: { base64: /\.png(\.part)?$/.test(e.path) ? pngHeader(...(rig.png ?? [600, 400])).toBase64() : 'SlBFRw==' } }))
  on('fs.exists', ($, e) => ({ value: !String(e.path).includes('.reload-note') }))
  on('fs.stat', () => ({ value: { kind: 'file', size: 323850, mtimeMs: 0, isLink: false } }))
  on('tool.list', () => ({
    value: [
      { name: `${SLACK}slack_send_message`, description: 'Send a message', mcp: true },
      { name: `${SLACK}slack_list_user_channels`, description: 'List channels', mcp: true },
      { name: `${SLACK}slack_get_file_upload_url`, description: 'Upload URL', mcp: true },
      { name: `${SLACK}slack_complete_file_upload`, description: 'Finish upload', mcp: true },
      { name: 'mcp__gm41l__send_message', description: 'Send a Gmail email', mcp: true },
    ],
  }))
  on('tool.call', async ($, e) => {
    if (e.tool === 'AskUserQuestion') return { result: { answers: { [e.questions[0].question]: 'Post it' } } }
    log.calls.push(e)
    const o = rig.tool?.(e)
    if (o !== undefined) return o
    if (e.tool === `${SLACK}slack_list_user_channels`) return { result: channelsReply(rig.channels ?? CHANNELS) }
    if (e.tool === `${SLACK}slack_get_file_upload_url`) return { result: TICKET_REPLY }
    if (e.tool === `${SLACK}slack_complete_file_upload`) {
      if (rig.completeDelay) await clock.sleep(rig.completeDelay)
      return { result: DONE_REPLY }
    }
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
  const uploads = () => log.calls.filter((c) => c.tool === `${SLACK}slack_complete_file_upload`).length
  return { clock, saved, log, uploads }
}

// A fake gallery server the test feeds lines to while it runs.
function galleryRig(on) {
  const queue: string[] = []
  let wake: (() => void) | null = null
  let closed = false
  const pushed: any[] = []
  on('process.spawn', async function* () {
    closed = false
    yield { stream: 'stdout', text: 'READY 5555\n' }
    while (!closed) {
      if (!queue.length) await new Promise<void>((r) => (wake = r))
      while (queue.length) yield { stream: 'stdout', text: queue.shift()! }
    }
    return { value: { code: 0, signal: null } }
  })
  on('http.fetch', ($, e) => {
    pushed.push(JSON.parse(e.init?.body ?? '{}'))
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  const kick = () => {
    const w = wake
    wake = null
    w?.()
  }
  return {
    pushed,
    raw(line: string) {
      queue.push(line + '\n')
      kick()
    },
    send(ev: unknown) {
      queue.push('EVENT ' + JSON.stringify(ev) + '\n')
      kick()
    },
    close() {
      closed = true
      kick()
    },
    // While the fake server is open, clock.settle waits ~1s for it: let the mod read the
    // queued events in real time, end the server, then settle.
    async flush(clock) {
      await new Promise((r) => setTimeout(r, 40))
      closed = true
      kick()
      await new Promise((r) => setTimeout(r, 10))
      await clock.settle()
      await clock.settle()
    },
  }
}

async function draftsReady($, clock, request = 'standups that run long') {
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'meme', args: request })
  await clock.settle()
}

async function openGallery($, clock) {
  await $.command.run({ command: 'meme', args: 'gallery' })
}

async function labels(ui, type = 'Button') {
  return (await ui.findAll({ type })).map((b) => b.props.label)
}

async function expectUniqueHotkeysAndKeys(ui, state: string) {
  const buttons = await ui.findAll({ type: 'Button' })
  const hotkeys = buttons.map((b) => b.props.hotkey).filter(Boolean)
  expect(new Set(hotkeys).size, `${state}: hotkeys ${JSON.stringify(hotkeys)}`).toBe(hotkeys.length)
  const keys = (await ui.findAll({})).map((el) => el.key).filter(Boolean)
  expect(new Set(keys).size, `${state}: keys ${JSON.stringify(keys)}`).toBe(keys.length)
}

// ---------------------------------------------------------------- writer and judge

test('writer: malformed JSON jams the factory with a retry, not a crash', async ($, on) => {
  const { clock } = factory(on, { writer: () => 'Sure! Here are some memes: drake / fine' })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /The factory jammed/ })).toBeDefined()
  expect(await ui.find({ key: 'retry' })).toBeDefined()
})

test('writer: empty candidates, unknown templates and non-array candidates all fail cleanly', async ($, on) => {
  const replies = [
    '{"candidates":[]}',
    '{"candidates":[{"template_id":"../../etc","lines":["a","b"]},{"template_id":"nope","lines":["x"]}]}',
    '{"candidates":{"template_id":"drake","lines":["a","b"]}}',
    '{"candidates":[{"template_id":"drake","lines":"not an array"}]}',
  ]
  let n = 0
  const { clock } = factory(on, { writer: () => replies[Math.min(n++, replies.length - 1)] })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (let i = 0; i < replies.length; i++) {
    expect(await ui.find({ type: 'Text', text: /No usable captions came back/ }), `reply ${i}`).toBeDefined()
    if (i < replies.length - 1) {
      await ui.press({ key: 'retry' })
      await clock.settle()
    }
  }
})

test('writer: the model not answering shows its reason', async ($, on) => {
  const { clock } = factory(on, { writer: () => ({ isAnswered: false, reason: 'overloaded' }) })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /didn't answer: overloaded/ })).toBeDefined()
})

test('writer: hostile lines (slashes, ?, emoji, ../, newlines, 5000 chars) still draw', async ($, on) => {
  const long = 'x'.repeat(5000)
  const { clock, log } = factory(on, {
    writer: () =>
      JSON.stringify({
        candidates: [
          { template_id: 'drake', lines: ['../../etc/passwd', 'why? 🤔 #yolo 100%'] },
          { template_id: 'fine', lines: ['line\nbreak', long] },
          { template_id: 'cmm', lines: ['<script>alert(1)</script>'] },
        ],
      }),
  })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'approve' })).toBeDefined()
  await ui.press({ key: 'copy' })
  const url = log.copied[0]
  expect(url).toMatch(/^https:\/\/api\.memegen\.link\/images\/[a-z0-9]+\/[^/]+\/[^/]+\.png$/)
  for (const k of ['draft-1', 'draft-2']) {
    await ui.press({ key: k })
    expect(await ui.find({ key: 'approve' })).toBeDefined()
  }
})

test('memegen URLs: a caption line of "." or ".." must not become a path segment that collapses', async () => {
  for (const line of ['.', '..']) {
    const url = memeUrl('drake', [line, 'b'])
    expect(new URL(url).pathname, `line ${JSON.stringify(line)} -> ${url}`).toMatch(/^\/images\/drake\/[^/]+\/b\.png$/)
  }
})

test('judge: garbage text leaves drafts unscored but usable', async ($, on) => {
  const { clock } = factory(on, { judge: () => 'I refuse to judge memes.' })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'draft-0' }))?.props.label).toBe('● Drakeposting')
})

test('judge: non-numeric scores must not show "NaN" on the draft tabs', async ($, on) => {
  const { clock } = factory(on, { judge: () => '{"scores":[{"i":0,"score":"great"},{"i":2,"score":null},{"i":4,"score":{}}]}' })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const l of await labels(ui)) expect(String(l)).not.toMatch(/NaN|null|object/)
})

test('judge: a judge that does not answer must not throw away good drafts', async ($, on) => {
  const { clock } = factory(on, { judge: () => ({ isAnswered: false, reason: 'rate limited' }) })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /jammed/ })).toBeUndefined()
  expect(await ui.find({ key: 'approve' })).toBeDefined()
})

// ---------------------------------------------------------------- races

test('race: a remix superseded by a newer remix never lands', async ($, on) => {
  let n = 0
  const { clock } = factory(on, {
    writerDelay: 1000,
    writer: () => {
      n++
      if (n === 2) return JSON.stringify({ candidates: [{ template_id: 'cmm', lines: ['STALE RESULT'] }] })
      return WRITER_REPLY
    },
  })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'remix' }) // write #2, slow
  await $.command.run({ command: 'meme', args: 'a different meme' }) // write #3, also slow, newer
  await clock.advance(1000)
  await clock.advance(1000)
  expect(await ui.find({ type: 'Text', text: 'STALE RESULT' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: 'a different meme' })).toBeDefined()
})

test('race: "back" from the gallery while a remix cooks must not reopen the old drafts for approval', async ($, on) => {
  const { clock } = factory(on, { writerDelay: 1000 })
  const g = galleryRig(on)
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'remix' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: '● Write' })).toBeDefined()
  await openGallery($, clock)
  g.send({ type: 'back' })
  await g.flush(clock)
  // Still cooking: the stage line shows and nothing can be approved yet.
  expect(await ui.find({ key: 'approve' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '● Write' })).toBeDefined()
  await clock.advance(1000)
})

test('race: a Slack upload that finishes after a new meme started must not leak into the new job', async ($, on) => {
  const { clock, uploads } = factory(on, { completeDelay: 1000 })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  await ui.press({ key: 'post' })
  await ui.press({ key: 'confirm' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /Posting to #all-maughanco/ })).toBeDefined()
  await $.command.run({ command: 'meme', args: 'a brand new meme' })
  await clock.settle()
  await clock.advance(1000)
  expect(uploads()).toBe(1)
  await ui.press({ key: 'approve' })
  // The new meme hasn't been sent anywhere.
  expect(await ui.find({ type: 'Text', text: /Sent so far/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Posted/ })).toBeUndefined()
})

test('race: cancel from the gallery while uploading must not drop back to the picker', async ($, on) => {
  const { clock, uploads } = factory(on, { completeDelay: 1000 })
  const g = galleryRig(on)
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  await ui.press({ key: 'post' })
  await ui.press({ key: 'confirm' })
  await clock.settle()
  await openGallery($, clock)
  g.send({ type: 'cancel' })
  await g.flush(clock)
  // The upload is still going: the panel must not offer to post again.
  expect(await ui.find({ key: 'post' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Posting to #all-maughanco/ })).toBeDefined()
  await clock.advance(1000)
  expect(uploads()).toBe(1)
})

test('race: two confirms from the gallery upload once', async ($, on) => {
  const { clock, uploads } = factory(on)
  const g = galleryRig(on)
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  await ui.press({ key: 'post' })
  await openGallery($, clock)
  g.send({ type: 'confirm' })
  g.send({ type: 'confirm' })
  await g.flush(clock)
  expect(uploads()).toBe(1)
  expect(await ui.find({ type: 'Text', text: '✓ Posted to #all-maughanco on Slack' })).toBeDefined()
})

test('approve, then remix, then approve a different draft: the new one is approved', async ($, on) => {
  const { clock } = factory(on)
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  await ui.press({ key: 'back' })
  await ui.press({ key: 'draft-2' })
  await ui.press({ key: 'approve' })
  expect(await ui.find({ type: 'Text', text: '✓ Approved · Change My Mind' })).toBeDefined()
  await ui.press({ key: 'back' })
  await ui.press({ key: 'remix' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /Approved/ })).toBeUndefined()
})

// ---------------------------------------------------------------- posting

test('posting: a garbage upload ticket shows an error with retry', async ($, on) => {
  const { clock } = factory(on, {
    settings: { askBeforePost: false, signature: true, favorites: [] },
    tool: (e) => (e.tool.endsWith('slack_get_file_upload_url') ? { result: { weird: [1, 2, { url: 'http://evil.example/x' }] } } : undefined),
  })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  await ui.press({ key: 'post' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /Couldn't post to #all-maughanco/ })).toBeDefined()
  expect(await ui.find({ key: 'retry-post' })).toBeDefined()
})

test('posting: curl failing, or answering without OK, is an error', async ($, on) => {
  let mode = 0
  const { clock, uploads } = factory(on, {
    settings: { askBeforePost: false, signature: true, favorites: [] },
    run: (argv) => (argv.includes('--data-binary') ? (mode === 0 ? { exitCode: 7, stdout: '', stderr: 'connection refused' } : { exitCode: 0, stdout: 'invalid_token', stderr: '' }) : undefined),
  })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  await ui.press({ key: 'post' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /connection refused/ })).toBeDefined()
  mode = 1
  await ui.press({ key: 'retry-post' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /invalid_token/ })).toBeDefined()
  expect(uploads()).toBe(0)
})

test('posting: complete_file_upload with no link still posts, with no Open button', async ($, on) => {
  const { clock } = factory(on, {
    settings: { askBeforePost: false, signature: true, favorites: [] },
    tool: (e) => (e.tool.endsWith('slack_complete_file_upload') ? { result: 'ok' } : undefined),
  })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  await ui.press({ key: 'post' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: '✓ Posted to #all-maughanco on Slack' })).toBeDefined()
  expect(await ui.find({ key: 'open-slack' })).toBeUndefined()
})

test('posting: complete_file_upload reporting an error must not say "Posted"', async ($, on) => {
  const { clock } = factory(on, {
    settings: { askBeforePost: false, signature: true, favorites: [] },
    tool: (e) => (e.tool.endsWith('slack_complete_file_upload') ? { isError: true, result: 'channel_not_found', text: 'channel_not_found' } : undefined),
  })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  await ui.press({ key: 'post' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /✓ Posted/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /Couldn't post/ })).toBeDefined()
})

test('posting: a denied complete_file_upload must not say "Posted"', async ($, on) => {
  const { clock } = factory(on, {
    settings: { askBeforePost: false, signature: true, favorites: [] },
    tool: (e) => (e.tool.endsWith('slack_complete_file_upload') ? { deny: 'Blocked by policy' } : undefined),
  })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  await ui.press({ key: 'post' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /✓ Posted/ })).toBeUndefined()
})

test('posting: corrupt history in the store must not break approve-and-post from chat', async ($, on) => {
  const { clock } = factory(on, {
    store: { history: { not: 'an array' } },
    chatReply: () => ({ reply: 'On it.', action: { type: 'post', draft: 2, destination: '#social' } }),
  })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'chat', text: 'post 2 to #social' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'Post to #social on Slack?' })).toBeDefined()
})

// ---------------------------------------------------------------- chat box

test('chat: non-JSON from the model gets the fallback reply and changes nothing', async ($, on) => {
  const { clock } = factory(on, { chatReply: () => 'lol idk' })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'chat', text: 'hello' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /Sorry, I didn't catch that/ })).toBeDefined()
  expect((await ui.find({ key: 'draft-0' }))?.props.label).toMatch(/^●/)
})

test('chat: select with draft 0 / 99 / null / "abc" leaves the pick alone; "2" works', async ($, on) => {
  let draft: unknown = 0
  const { clock } = factory(on, { chatReply: () => ({ reply: 'ok', action: { type: 'select', draft } }) })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  for (const d of [0, 99, null, 'abc', -1, 1.5]) {
    draft = d
    await ui.input({ key: 'chat', text: `use ${d}` })
    await clock.settle()
    expect((await ui.find({ key: 'draft-0' }))?.props.label, `draft ${JSON.stringify(d)}`).toMatch(/^●/)
  }
  draft = '2'
  await ui.input({ key: 'chat', text: 'use 2' })
  await clock.settle()
  expect((await ui.find({ key: 'draft-1' }))?.props.label).toMatch(/^●/)
})

test('chat: "approve draft 99" must not approve some other draft', async ($, on) => {
  const { clock } = factory(on, { chatReply: () => ({ reply: 'Approved!', action: { type: 'approve', draft: 99 } }) })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'chat', text: 'approve 99' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /✓ Approved/ })).toBeUndefined()
})

test('chat: "post draft 3" after draft 1 was approved posts draft 3', async ($, on) => {
  const { clock } = factory(on, { chatReply: () => ({ reply: 'Draft 3 to #social.', action: { type: 'post', draft: 3, destination: '#social' } }) })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  expect(await ui.find({ type: 'Text', text: '✓ Approved · Drakeposting' })).toBeDefined()
  await ui.input({ key: 'chat', text: 'actually post 3 to #social' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: '✓ Approved · Change My Mind' })).toBeDefined()
})

test('chat: unknown action, empty post destination and empty new request do nothing harmful', async ($, on) => {
  let action: any = { type: 'self_destruct' }
  const { clock, log, uploads } = factory(on, { chatReply: () => ({ reply: 'ok', action }) })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'chat', text: 'boom' })
  await clock.settle()
  expect(await ui.find({ key: 'approve' })).toBeDefined()

  action = { type: 'new', request: '' }
  await ui.input({ key: 'chat', text: 'new' })
  await clock.settle()
  expect(await ui.find({ key: 'approve' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'standups that run long' })).toBeDefined()

  action = { type: 'post', destination: '' }
  await ui.input({ key: 'chat', text: 'post it' })
  await clock.settle()
  expect(log.submitted.length).toBe(0)
  expect(uploads()).toBe(0)
  expect(await ui.find({ type: 'Text', text: /Post to .* on Slack\?/ })).toBeUndefined()
})

test('chat: a non-string reply from the model is not shown as "[object Object]"', async ($, on) => {
  const { clock } = factory(on, { chatReply: () => ({ reply: { text: 'hi' }, action: { type: 'none' } }) })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'chat', text: 'hi' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: /\[object Object\]/ })).toBeUndefined()
})

test('chat: "#social-media" goes to #social-media, not to a favorite named "#social"', async ($, on) => {
  const { clock } = factory(on, {
    channels: [
      ['social', 'C0SOCIAL'],
      ['social-media', 'C0SOCMEDIA'],
    ],
    settings: { askBeforePost: true, signature: true, favorites: [{ label: '#social', target: '#social on Slack', channelId: 'C0SOCIAL', channelName: 'social' }] },
    chatReply: () => ({ reply: 'Off to #social-media.', action: { type: 'post', destination: '#social-media' } }),
  })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'chat', text: 'post it to #social-media' })
  await clock.settle()
  expect(await ui.find({ type: 'Text', text: 'Post to #social-media on Slack?' })).toBeDefined()
})

// ---------------------------------------------------------------- the Post-to Select

test('Select: values unique, value among options, "add" hands off without changing the pick', async ($, on) => {
  const { clock, log } = factory(on, {
    settings: {
      askBeforePost: true,
      signature: true,
      favorites: [
        { label: '#gone', target: '#gone on Slack', channelId: 'C0GONE', channelName: 'gone' },
        { label: 'Email', target: 'Email' },
        { label: '#social', target: '#social on Slack', channelId: 'C0C5HB6PETU', channelName: 'social' },
      ],
    },
  })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  const sel = await ui.find({ key: 'post-to' })
  const values = (sel?.props.options as any[]).map((o) => o.value)
  expect(new Set(values).size).toBe(values.length)
  if (sel?.props.value !== undefined) expect(values).toContain(sel.props.value)
  await ui.select({ key: 'post-to', value: 'add' })
  expect(log.submitted.some((t) => t.includes('add a connector'))).toBe(true)
  expect(await ui.find({ key: 'post-to' })).toBeDefined()
  await ui.select({ key: 'post-to', value: 'claude:Email' })
  expect((await ui.find({ key: 'post' }))?.props.label).toBe('Post to Email')
  const sel2 = await ui.find({ key: 'post-to' })
  expect(sel2?.props.value).toBe('claude:Email')
  await expectUniqueHotkeysAndKeys(ui, 'pick with favorites')
})

test('Select: two favorites for the same channel must not draw duplicate keys', async ($, on) => {
  const { clock } = factory(on, {
    settings: {
      askBeforePost: true,
      signature: true,
      favorites: [
        { label: '#social', target: '#social on Slack', channelId: 'C0C5HB6PETU', channelName: 'social' },
        { label: 'memes', target: '#social on Slack', channelId: 'C0C5HB6PETU', channelName: 'social' },
      ],
    },
  })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  await expectUniqueHotkeysAndKeys(ui, 'pick with duplicate favorites')
})

test('Select: a favorite saved from the gallery for an unknown channel has a real name on its buttons', async ($, on) => {
  const { clock } = factory(on)
  const g = galleryRig(on)
  await draftsReady($, clock)
  await openGallery($, clock)
  g.send({ type: 'settings', settings: { favorites: [{ label: 'Team memes', channelId: 'C0ZZZ' }] } })
  await g.flush(clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  for (const l of await labels(ui)) expect(String(l)).not.toMatch(/#$/)
  const opts = ((await ui.find({ key: 'post-to' }))?.props.options as any[]).map((o) => o.label)
  for (const l of opts) expect(String(l)).not.toMatch(/#$/)
})

// ---------------------------------------------------------------- settings

test('settings: a corrupt favorites value in the store must not break the posting view', async ($, on) => {
  const { clock } = factory(on, { settings: { askBeforePost: true, signature: true, favorites: 'oops' } })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' }).catch(() => {})
  await ui.drawn()
  expect(await ui.find({ key: 'post-to' })).toBeDefined()
})

test('settings: gallery favorites are sanitized, trimmed and capped at 20', async ($, on) => {
  const { clock, saved } = factory(on)
  const g = galleryRig(on)
  await draftsReady($, clock)
  await openGallery($, clock)
  const many = Array.from({ length: 25 }, (_, i) => ({ label: `  fav ${i}  `, target: `t${i}` }))
  g.send({
    type: 'settings',
    settings: {
      askBeforePost: 'false',
      signature: 0,
      favorites: [null, 5, 'x', { label: 'L'.repeat(100), target: 'big' }, { label: '', target: 't' }, { label: 'evil', channelId: '../../x' }, ...many],
    },
  })
  await g.flush(clock)
  const s = saved.get('settings') as any
  expect(s.askBeforePost).toBe(true)
  expect(s.signature).toBe(true)
  expect(s.favorites.length).toBe(20)
  expect(s.favorites[0]).toEqual({ label: 'L'.repeat(60), target: 'big' })
  expect(s.favorites[1]).toEqual({ label: 'fav 0', target: 't0' })
  expect(s.favorites.some((f) => f.label === 'evil')).toBe(false)
})

test('settings: saving a 21st favorite after posting keeps it (or says it did not)', async ($, on) => {
  const favorites = Array.from({ length: 20 }, (_, i) => ({ label: `place ${i}`, target: `place ${i}` }))
  const { clock, saved, log } = factory(on, { settings: { askBeforePost: false, signature: true, favorites } })
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  await ui.press({ key: 'ch-C0C5HB6PETU' })
  await ui.press({ key: 'post' })
  await clock.settle()
  await ui.press({ key: 'favorite' })
  const favs = (saved.get('settings') as any).favorites
  const kept = favs.some((f) => f.channelId === 'C0C5HB6PETU')
  const claimed = log.toasts.some((t) => /Saved #social/.test(t))
  expect(kept || !claimed, `toast said saved; favorites: ${JSON.stringify(favs.map((f) => f.label))}`).toBe(true)
})

// ---------------------------------------------------------------- gallery events

test('gallery: hostile event payloads are ignored, and later events still work', async ($, on) => {
  const { clock, log } = factory(on)
  const g = galleryRig(on)
  await draftsReady($, clock)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await openGallery($, clock)
  for (const index of ['abc', -1, NaN, 1.5, 3, 1e9, null, { valueOf: 1 }]) g.send({ type: 'select', index })
  g.raw('EVENT {not json')
  g.raw('EVENT null')
  g.raw('EVENT "approve"')
  g.raw('EVENT [1,2]')
  g.raw('GARBAGE LINE')
  g.send({ type: '__proto__', index: 0 })
  g.send({ type: 'constructor' })
  g.send({ type: 'post', channelId: 'C0NOTREAL' })
  g.send({ type: 'approve', index: -1 })
  g.send({ type: 'confirm' })
  g.send({ type: 'favorite' })
  // Huge chat text is clipped to 300 characters
  g.send({ type: 'chat', text: 'y'.repeat(100000) })
  // A valid event after all that still lands
  g.send({ type: 'select', index: 2 })
  await g.flush(clock)
  expect((await ui.find({ key: 'draft-2' }))?.props.label).toMatch(/^●/)
  expect(await ui.find({ key: 'approve' })).toBeDefined()
  const you = await ui.find({ type: 'Text', text: /^y+$/ })
  expect(you?.text.length).toBe(300)

  // post to a channel not in the list with no target: nothing posted or handed off
  await openGallery($, clock)
  g.send({ type: 'approve', index: 2 })
  g.send({ type: 'post', channelId: 'C0NOTREAL' })
  g.send({ type: 'post', channelId: { $ne: null } })
  await g.flush(clock)
  expect(await ui.find({ type: 'Text', text: '✓ Approved · Change My Mind' })).toBeDefined()
  expect(log.submitted.length).toBe(0)
  expect(await ui.find({ type: 'Text', text: /on Slack\?/ })).toBeUndefined()
})

// ---------------------------------------------------------------- layout

async function reach($, on, state: string, extra: Rig = {}) {
  const rig: Rig = { ...extra }
  if (state === 'working') rig.writerDelay = 1000
  if (state === 'error') rig.writer = () => 'nope'
  if (state === 'posting') rig.completeDelay = 1000
  if (state === 'post-error') rig.tool = (e) => (e.tool.endsWith('slack_get_file_upload_url') ? { result: 'nope' } : undefined)
  const f = factory(on, rig)
  const { clock } = f
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  if (state === 'idle') {
    await $.command.run({ command: 'meme', args: '' })
    return f
  }
  await $.command.run({ command: 'meme', args: 'standups that run long' })
  await clock.settle()
  if (state === 'working') {
    // second write is slow: remix and stay working
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.press({ key: 'remix' })
    await ui.unmount()
    return f
  }
  if (state === 'review' || state === 'error') return f
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'approve' })
  if (state === 'pick') return (await ui.unmount(), f)
  await ui.press({ key: 'post' })
  if (state === 'confirm') return (await ui.unmount(), f)
  await ui.press({ key: 'confirm' })
  await clock.settle()
  await ui.unmount()
  return f
}

const STATES = ['idle', 'working', 'review', 'error', 'pick', 'confirm', 'posting', 'done', 'post-error']

for (const state of STATES) {
  test(`inline, state ${state}: draws (not refused), no Image, unique hotkeys and keys`, async ($, on) => {
    await reach($, on, state)
    const ui = await $.ui.mount({ ...INLINE, surface: 'terminal' })
    await ui.drawn()
    expect(await ui.find({ type: 'Image' })).toBeUndefined()
    await expectUniqueHotkeysAndKeys(ui, `inline ${state}`)
  })

  test(`docked, state ${state}: unique hotkeys and keys`, async ($, on) => {
    await reach($, on, state)
    const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
    await ui.drawn()
    await expectUniqueHotkeysAndKeys(ui, `docked ${state}`)
  })
}

test('a degenerate 0x0 PNG does not break the picture', async ($, on) => {
  await reach($, on, 'review', { png: [0, 0] })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.drawn()
  const img = await ui.find({ type: 'Image' })
  if (img) {
    expect(Number.isFinite(img.props.columns as number)).toBe(true)
    expect(Number.isFinite(img.props.rows as number)).toBe(true)
  }
})

test('a very narrow docked pane never draws a picture wider than its body', async ($, on) => {
  await reach($, on, 'review')
  const NARROW = { ...PANE, props: { ...PANE.props, bodyColumns: 6, scroll: { offset: 0, bodyRows: 10 } } } as const
  const ui = await $.ui.mount({ ...NARROW, surface: 'terminal' })
  const img = await ui.find({ type: 'Image' })
  if (img) expect(img.props.columns as number).toBeLessThanOrEqual(6)
})
