import { expect, mock, test } from 'claude-code/testing'
import { decodeBmp, encodeLine, memeUrl, parseJson, rasterFromImage, topDrafts } from '../hooks/lib.js'

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

// A 2x2 24-bit bottom-up BMP: red, green on top; blue, white below.
function tinyBmp(): Uint8Array {
  const stride = 8
  const bytes = new Uint8Array(54 + stride * 2)
  const v = new DataView(bytes.buffer)
  v.setUint16(0, 0x424d, false)
  v.setUint32(2, bytes.length, true)
  v.setUint32(10, 54, true)
  v.setUint32(14, 40, true)
  v.setInt32(18, 2, true)
  v.setInt32(22, 2, true)
  v.setUint16(26, 1, true)
  v.setUint16(28, 24, true)
  const px = (row: number, x: number, [r, g, b]: number[]) => bytes.set([b, g, r], 54 + row * stride + x * 3)
  px(1, 0, [255, 0, 0])
  px(1, 1, [0, 255, 0])
  px(0, 0, [0, 0, 255])
  px(0, 1, [255, 255, 255])
  return bytes
}

function factory(on, { feedbackSeen = [] as string[], submitted = [] as string[], copied = [] as string[] } = {}) {
  const saved = new Map<string, unknown>()
  const clock = mock.clock(on)
  on('session.start', () => ({ cwd: '/work' }))
  on('env.get', ($, e) => ({ value: e.name === 'HOME' ? '/home/test' : undefined }))
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
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('fs.read', ($, e) => ({ value: { base64: e.path.endsWith('.bmp') ? tinyBmp().toBase64() : 'SlBFRw==' } }))
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
  expect(await review.find({ type: 'Text', text: '“everyone reads their Jira tickets aloud”' })).toBeDefined()
  expect(await review.find({ type: 'Raster' })).toBeDefined()

  await review.press({ key: 'draft-1' })
  expect(await review.find({ type: 'Text', text: '“standup is at minute 40, this is fine”' })).toBeDefined()

  await review.press({ key: 'approve' })
  expect(await review.find({ key: 'post-slack' })).toMatchObject({ props: { label: 'Slack ✓' } })
  expect(await review.find({ key: 'post-linkedin' })).toMatchObject({ props: { label: 'LinkedIn' } })

  await review.press({ key: 'post-slack' })
  expect(submitted.length).toBe(1)
  expect(submitted[0]).toContain('posted to Slack')
  expect(submitted[0]).toContain('https://api.memegen.link/images/fine/_/standup_is_at_minute_40,_this_is_fine.png')
  expect(submitted[0]).toMatch(/confirm the exact destination/)
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
  expect(await ui.find({ type: 'Raster' })).toBeUndefined()

  await ui.press({ key: 'copy' })
  expect(copied[0]).toMatch(/^https:\/\/api\.memegen\.link\/images\/drake\//)

  await ui.input({ key: 'feedback', text: 'make it meaner' })
  await clock.settle()
  expect(feedbackSeen.length).toBe(1)
  expect(feedbackSeen[0]).toContain('"make it meaner"')
  expect(feedbackSeen[0]).toContain('Use exactly these templates: drake')
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

test('helpers: memegen escaping, JSON in fences, ranking, BMP to half-blocks', async () => {
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

  const img = decodeBmp(tinyBmp())
  expect(img).toMatchObject({ width: 2, height: 2 })
  expect(Array.from(img.rgb)).toEqual([0xff0000, 0x00ff00, 0x0000ff, 0xffffff])
  const raster = rasterFromImage(img)
  expect(raster).toMatchObject({ columns: 2, rows: 1 })
  const cells = Array.from(new Uint32Array(Uint8Array.fromBase64(raster.cells).buffer))
  expect(cells).toEqual([0x2580, 0xff0000, 0x0000ff, 0x2580, 0x00ff00, 0xffffff])
})
