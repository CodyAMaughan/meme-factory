import { expect, mock, test } from 'claude-code/testing'
import { encodeLine, imageCells, memeUrl, parseJson, pngSize, topDrafts } from '../hooks/lib.js'

const TOOL = 'mcp__meme-factory__make_meme'

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
const JUDGE_REPLY = '```json\n{"scores":[{"i":0,"score":6},{"i":1,"score":9},{"i":2,"score":8},{"i":3,"score":2},{"i":4,"score":7},{"i":5,"score":3}]}\n```'

// The first bytes of a 600x400 PNG: signature, then the IHDR chunk.
function pngHeader(width = 600, height = 400): Uint8Array {
  const bytes = new Uint8Array(33)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52])
  const v = new DataView(bytes.buffer)
  v.setUint32(16, width)
  v.setUint32(20, height)
  return bytes
}

function factory(on, { feedbackSeen = [] as string[], submitted = [] as string[], copied = [] as string[], ran = [] as string[][], termProgram = 'ghostty' } = {}) {
  const saved = new Map<string, unknown>()
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('env.get', ($, e) => ({ value: ({ HOME: '/Users/test', TERM_PROGRAM: termProgram } as Record<string, string>)[e.name] }))
  on('tool.register', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.copy', ($, e) => {
    copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('session.surfaces', () => ({ value: ['terminal', 'desktop'] }))
  on('model.complete', ($, e) => {
    if (e.system.includes('judge')) return { value: { isAnswered: true, text: JUDGE_REPLY, usage: USAGE } }
    if (e.prompt.includes('User feedback')) feedbackSeen.push(e.prompt)
    return { value: { isAnswered: true, text: WRITER_REPLY, usage: USAGE } }
  })
  on('process.run', ($, e) => {
    ran.push(e.argv)
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('fs.read', ($, e) => ({ value: { base64: e.path.endsWith('.png') ? pngHeader().toBase64() : 'SlBFRw==' } }))
  on('tool.list', () => ({
    value: [
      { name: 'mcp__a1b2__slack_send_message', description: 'Send a message to a Slack channel', mcp: true },
      { name: 'Bash', description: 'Run a shell command', mcp: false },
    ],
  }))
  on('store.get', ($, e) => ({ value: saved.get(e.key) }))
  on('store.set', ($, e) => {
    saved.set(e.key, e.value)
    return { value: undefined }
  })
  on('prompt.submit', ($, e) => {
    submitted.push(e.text)
    return { text: e.text }
  })
  return { clock, saved }
}

test('Claude asks for a meme: the tool returns at once and the drafts cook in the panel', async ($, on) => {
  const submitted: string[] = []
  const { clock, saved } = factory(on, { submitted })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

  const answer = await $.tool.call({ tool: TOOL, tool_use_id: 't1', request: 'standups that run long' })
  expect(answer.result).toMatch(/side panel/)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Writing captions/ })).toBeDefined()
  await ui.unmount()

  await clock.settle()

  const review = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Best-scored draft first, one per template: drake 9, fine 8, cmm 7
  expect(await review.find({ key: 'draft-0' })).toMatchObject({ props: { label: 'Drakeposting' } })
  expect(await review.find({ key: 'draft-1' })).toMatchObject({ props: { label: 'This is Fine' } })
  expect(await review.find({ type: 'Text', text: 'everyone reads their Jira tickets aloud' })).toBeDefined()
  // A real picture in the terminal: the Image element reads the cached PNG, keeping its 3:2 shape
  const image = await review.find({ type: 'Image' })
  expect(image).toMatchObject({ props: { source: { file: '/Users/test/.cache/meme-factory/' + (image as any).props.source.file.split('/').pop(), format: 'png' }, columns: 56, rows: 19 } })
  expect((image as any).props.alt).toMatch(/^Expectation|^Drakeposting/)

  await review.press({ key: 'draft-1' })
  expect(await review.find({ type: 'Text', text: 'standup is at minute 40, this is fine' })).toBeDefined()

  await review.press({ key: 'approve' })
  expect(await review.find({ key: 'post-slack' })).toMatchObject({ props: { label: 'Slack ✓' } })
  expect(await review.find({ key: 'post-linkedin' })).toMatchObject({ props: { label: 'LinkedIn' } })

  await review.press({ key: 'post-slack' })
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('wants it posted to: Slack')
  expect(submitted[0]).toContain('https://api.memegen.link/images/fine/_/standup_is_at_minute_40,_this_is_fine.png')
  expect(submitted[0]).toMatch(/will ask the user to approve the actual post call/)
  expect((saved.get('history') as unknown[]).length).toBe(1)
})

test('Desktop draws the meme as an SVG, and feedback remixes with the notes', async ($, on) => {
  const feedbackSeen: string[] = []
  const copied: string[] = []
  const { clock } = factory(on, { feedbackSeen, copied })
  await $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'meme', args: 'standups that run long' })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  expect(await ui.find({ type: 'Image' })).toBeUndefined()

  await ui.press({ key: 'copy' })
  expect(copied[0]).toMatch(/^https:\/\/api\.memegen\.link\/images\/drake\//)

  await ui.input({ key: 'feedback', text: 'make it meaner' })
  await clock.settle()
  expect(feedbackSeen.length).toBe(1)
  expect(feedbackSeen[0]).toContain('"make it meaner"')
  expect(feedbackSeen[0]).toContain('Use exactly these templates: drake')
})

const tick = () => new Promise((r) => setTimeout(r, 30))

test('View opens the browser gallery, and choices made there come back to the mod', async ($, on) => {
  const ran: string[][] = []
  const submitted: string[] = []
  const pushed: any[] = []
  const { clock, saved } = factory(on, { ran, submitted })
  // The gallery server: ready on port 5555, then the person picks draft 3, saves a favorite, and posts there
  const spawned: any[] = []
  on('process.spawn', async function* ($, e) {
    spawned.push(e)
    yield { stream: 'stdout', text: 'READY 5555\nEVENT {"type":"select","index":2}\n' }
    yield { stream: 'stdout', text: 'EVENT {"type":"approve","index":2}\nEVENT {"type":"settings","settings":{"favorites":[{"label":"Team","target":"the #memes channel on Slack"}]}}\n' }
    yield { stream: 'stdout', text: 'EVENT {"type":"post","target":"the #memes channel on Slack","label":"Team"}\nEVENT {"type":"approve","index":99}\n' }
    return { value: { code: 0, signal: null } }
  })
  on('http.fetch', ($, e) => {
    pushed.push({ url: e.url, token: e.init?.headers?.['X-Meme-Token'], body: JSON.parse(e.init?.body ?? '{}') })
    return { value: { status: 204, ok: true, headers: {}, text: '' } }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'meme', args: 'standups that run long' })
  await clock.settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The terminal has no Link row (it would print the whole URL); View in browser covers it
  expect(await ui.find({ type: 'Link' })).toBeUndefined()
  await ui.press({ key: 'view' })
  for (let i = 0; i < 20 && !submitted.length; i++) await tick()

  const opened = ran.find((argv) => argv[0] === 'open')
  expect(opened?.[1]).toMatch(/^http:\/\/127\.0\.0\.1:5555\/#t=[0-9a-f]{48}&tab=drafts$/)
  const token = opened![1].split('#t=')[1].split('&')[0]
  // The token reaches the server on stdin, never on its command line
  expect(spawned[0].argv.join(' ')).not.toContain(token)
  expect(spawned[0].input).toBe(token + '\n')
  expect(pushed.every((p) => p.url === 'http://127.0.0.1:5555/api/state' && p.token === token)).toBe(true)
  // No local file paths reach the page
  expect(JSON.stringify(pushed)).not.toContain('/Users/test')

  const last = pushed.at(-1).body
  expect(last).toMatchObject({ status: 'approved', approved: { template_name: 'Change My Mind' } })
  expect(last.settings.favorites).toEqual([{ label: 'Team', target: 'the #memes channel on Slack' }])
  expect(saved.get('settings')).toMatchObject({ askBeforePost: true, favorites: [{ label: 'Team' }] })
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('wants it posted to: the #memes channel on Slack')
  expect(submitted[0]).toContain('Work out which connector')
})

test('/meme settings opens the gallery on its Settings tab', async ($, on) => {
  const ran: string[][] = []
  factory(on, { ran })
  on('process.spawn', async function* () {
    yield { stream: 'stdout', text: 'READY 6000\n' }
    return { value: { code: 0, signal: null } }
  })
  on('http.fetch', () => ({ value: { status: 204, ok: true, headers: {}, text: '' } }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const answer = await $.command.run({ command: 'meme', args: 'settings' })
  expect(answer.text).toMatch(/gallery/)
  expect(ran.find((argv) => argv[0] === 'open')?.[1]).toMatch(/:6000\/#t=[0-9a-f]+&tab=settings$/)
})

test('ask-before-posting holds a connector call that carries a meme link', async ($, on) => {
  const { saved } = factory(on)
  const asked: string[] = []
  let answer = 'Post it'
  on('tool.call', ($, e) => {
    if (e.tool === 'AskUserQuestion') {
      asked.push(e.questions[0].question)
      return { result: { answers: { [e.questions[0].question]: answer } } }
    }
    return { result: 'sent' }
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  const meme = { tool: 'mcp__a1b2__slack_send_message', tool_use_id: 't2', channel: '#memes', text: 'lol https://api.memegen.link/images/fine/_/this_is_fine.png' }

  expect(await $.tool.call(meme)).toEqual({ result: 'sent' })
  expect(asked[0]).toMatch(/let Claude post this meme with slack_send_message/)

  answer = "Don't post"
  expect(await $.tool.call({ ...meme, tool_use_id: 't3' })).toEqual({ deny: 'The user declined posting this meme.' })
  // Ordinary connector calls and Claude's own tools are never held
  expect(await $.tool.call({ tool: 'mcp__a1b2__slack_send_message', tool_use_id: 't4', text: 'hello' })).toEqual({ result: 'sent' })
  expect(await $.tool.call({ tool: 'Bash', tool_use_id: 't5', command: 'echo https://api.memegen.link/images/x.png' })).toEqual({ result: 'sent' })
  expect(asked.length).toBe(2)
  expect(saved.get('settings')).toBeUndefined()
})

test('a terminal without inline images gets a one-line note, not an empty image box', async ($, on) => {
  const { clock } = factory(on, { termProgram: 'Apple_Terminal' })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'meme', args: 'standups that run long' })
  await clock.settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /No inline images in this terminal/ })).toBeDefined()
  expect(await ui.find({ key: 'approve' })).toBeDefined()
})

test('the panel opens empty and takes a request', async ($, on) => {
  const { clock } = factory(on)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  await $.command.run({ command: 'meme', args: '' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'request' })).toBeDefined()
  await ui.input({ key: 'request', text: 'cats on keyboards' })
  await clock.settle()
  expect(await ui.find({ key: 'approve' })).toBeDefined()
})

test('helpers: memegen escaping, JSON in fences, ranking, PNG sizing', async () => {
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
  expect(imageCells({ width: 600, height: 600 }, 300)).toEqual({ columns: 255, rows: 128 })
})
