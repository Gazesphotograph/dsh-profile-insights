// Focused regressions against the actual profile host and client functions.
// Run: node tests/profile-regression.mjs
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { apply, ROUTE_PREFIX, foldSession, aggregate, parseDayKey, shiftDay } from '../index.js'

const cases = []
const check = (label, fn) => cases.push({ label, fn })
const flush = async () => { for (let i = 0; i < 12; i += 1) await Promise.resolve() }
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const options = { today: '2026-11-03', activityDays: 365, topModels: 6, topTools: 8, totalSkills: 0, profile: {}, skippedSessions: 0 }
const sample = (name = 'Current') => ({
  ok: true, profile: { name }, totals: { sessions: 1, turns: 1, steps: 1, tokens: { total: 100 } },
  activity: { start: '2026-11-01', end: '2026-11-03', days: [] }, insights: {},
})
const response = (name) => ({ ok: true, json: async () => sample(name) })

function host(services = {}, config = {}) {
  const routes = new Map()
  let reads = 0
  apply({
    effect(fn) { fn() },
    get(name) {
      if (name === 'connection') return { fetch: { register(route) { routes.set(route.path, route); return () => {} } } }
      return services[name]
    },
    sessionQuery: {
      async listSessions() { reads += 1; return [] },
      async readSession() { throw new Error('empty corpus') },
    },
  }, { displayName: 'Fallback', ...config })
  return {
    call: (path = 'stats', method = 'GET') => routes.get(`${ROUTE_PREFIX}/${path}`).fetch(new Request(`http://x/${path}`, { method })),
    reads: () => reads,
  }
}

// Instrument only the module registration return so the original private
// helpers can be exercised; the production algorithms are never copied here.
const clientSource = await readFile(new URL('../client.js', import.meta.url), 'utf8')
const clientMarker = "    return {\n      inject: ['slots', 'locale'],"
assert.ok(clientSource.includes(clientMarker), 'client test export anchor exists')
const instrumented = clientSource.replace(clientMarker,
  "    return {\n      testing: { buildCalendar, aggregateCells, Heatmap, Page, Identity, prepareAvatar, formatDuration, zh, en },\n      inject: ['slots', 'locale'],")
let currentRunner
const React = {
  createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) }),
  useState: (initial) => currentRunner.state(initial),
  useRef: (initial) => currentRunner.ref(initial),
  useEffect: (effect, deps) => currentRunner.effect(effect, deps),
  useMemo: (fn, deps) => currentRunner.memo(fn, deps),
  useCallback: (fn, deps) => currentRunner.memo(() => fn, deps),
}
let definition
new Function('window', 'navigator', instrumented)({ __ModuleLoader__: { load: (value) => { definition = value } } }, { language: 'en' })
const client = definition.factory((id) => { assert.equal(id, 'react'); return React }).testing
const t = (key) => client.en[key] ?? key

function runner(Component = client.Page, props = { t }) {
  const slots = []
  let index = 0
  let effects = []
  let tree
  let unmounted = false
  let lateWrites = 0
  const run = {
    state(initial) {
      const slot = index++
      if (!(slot in slots)) slots[slot] = { value: typeof initial === 'function' ? initial() : initial }
      return [slots[slot].value, (value) => {
        if (unmounted) lateWrites += 1
        slots[slot].value = typeof value === 'function' ? value(slots[slot].value) : value
      }]
    },
    ref(initial) {
      const slot = index++
      if (!(slot in slots)) slots[slot] = { current: initial }
      return slots[slot]
    },
    memo(factory, deps) {
      const slot = index++
      const previous = slots[slot]
      if (!previous || deps?.some((value, i) => value !== previous.deps?.[i])) slots[slot] = { deps, value: factory() }
      return slots[slot].value
    },
    effect(effect, deps) {
      const slot = index++
      const previous = slots[slot]
      if (!previous || deps?.some((value, i) => value !== previous.deps?.[i])) {
        effects.push(() => { previous?.cleanup?.(); slots[slot] = { deps, effect, cleanup: effect() } })
      }
    },
    render() {
      index = 0
      currentRunner = run
      tree = Component(props)
      currentRunner = null
      const pending = effects
      effects = []
      for (const effect of pending) effect()
      return tree
    },
    // React StrictMode cleans up and restarts effects while retaining state/refs.
    restartEffects() {
      const existing = slots.filter((slot) => typeof slot?.effect === 'function')
      for (const slot of existing) slot.cleanup?.()
      for (const slot of existing) slot.cleanup = slot.effect()
    },
    unmount() {
      for (const slot of slots) slot?.cleanup?.()
      unmounted = true
    },
    stateValue: () => slots[0].value,
    lateWrites: () => lateWrites,
  }
  return run
}
function nodes(tree, predicate) {
  if (tree === null || typeof tree !== 'object') return []
  return [...(predicate(tree) ? [tree] : []), ...(tree.children ?? []).flatMap((child) => nodes(child, predicate))]
}
const buttons = (tree) => nodes(tree, (node) => node.type === 'button')

check('cross-midnight replacement leaves no phantom activity day or streak', () => {
  const before = parseDayKey('2026-11-02').getTime() + 86_399_000
  const after = parseDayKey('2026-11-03').getTime() + 1_000
  const folded = foldSession([
    { type: 'assistant/message', time: before, data: { turn: 1, step: 1, usage: { inputTokens: 10 } } },
    { type: 'assistant/message', time: after, data: { turn: 1, step: 1, usage: { inputTokens: 20 } } },
  ], { id: 'midnight' })
  const result = aggregate([folded], options)
  assert.equal(result.totals.tokens.total, 20)
  assert.equal(result.totals.activeDays, 1)
  assert.equal(result.streaks.current, 1)
  assert.deepEqual(result.activity.days.map((day) => day.date), ['2026-11-03'])
})

check('a genuine turn-only day still counts after its usage is replaced', () => {
  const first = parseDayKey('2026-11-02').getTime() + 1_000
  const second = parseDayKey('2026-11-03').getTime() + 1_000
  const folded = foldSession([
    { type: 'turn/start', time: first, data: { turn: 1 } },
    { type: 'assistant/message', time: first + 1, data: { turn: 1, step: 1, usage: { inputTokens: 10 } } },
    { type: 'assistant/message', time: second, data: { turn: 1, step: 1, usage: { inputTokens: 20 } } },
  ], { id: 'turn-only' })
  const result = aggregate([folded], options)
  assert.equal(result.streaks.current, 2)
  assert.equal(result.totals.activeDays, 2)
  assert.equal(result.activity.days[0].tokens, 0)
  assert.equal(result.activity.days[0].turns, 1)
})

check('malformed usage cannot create negative or non-finite token totals', () => {
  const folded = foldSession([
    { type: 'assistant/message', time: Date.now(), data: { turn: 1, step: 1, usage: { inputTokens: Infinity, outputTokens: -10, cacheReadTokens: 5, cacheWriteTokens: NaN } } },
  ], { id: 'invalid-usage' })
  assert.deepEqual(folded.tokens, { input: 0, output: 0, cacheRead: 5, cacheWrite: 0 })
})

check('optional account sync failures fall back without failing /stats', async () => {
  for (const account of [
    { getState() { throw new Error('account offline') } },
    { async getState() { return { status: 'credential-stored' } }, getProfile() { throw new Error('profile offline') } },
  ]) {
    const result = await host({ deepseekAccount: account }).call()
    assert.equal(result.status, 200)
    assert.equal((await result.json()).profile.name, 'Fallback')
  }
})

check('optional skill discovery is bounded and rejected discovery is harmless', async () => {
  for (const list of [() => new Promise(() => {}), () => Promise.reject(new Error('offline'))]) {
    const api = host({ skills: { list } }, { skillTimeoutMs: 5 })
    const timeout = new AbortController()
    const watchdog = setTimeout(() => timeout.abort(), 200)
    try {
      const result = await Promise.race([
        api.call(),
        new Promise((_, reject) => timeout.signal.addEventListener('abort', () => reject(new Error('stats hung on optional skills')), { once: true })),
      ])
      assert.equal(result.status, 200)
      assert.equal((await result.json()).insights.skills.total, 0)
    } finally { clearTimeout(watchdog) }
  }
})

check('timed-out optional discovery can recover on refresh and cached GET stays cached', async () => {
  let available = false
  const api = host({ skills: { list: () => available ? ['a', 'b'] : new Promise(() => {}) } }, { skillTimeoutMs: 5 })
  const first = await (await api.call()).json()
  assert.equal(first.insights.skills.total, 0)
  await api.call()
  assert.equal(api.reads(), 1, 'fresh GET uses the cache')
  available = true
  const refreshed = await (await api.call('refresh', 'POST')).json()
  assert.equal(refreshed.insights.skills.total, 2)
  assert.equal(api.reads(), 2, 'refresh runs a fresh collection')
})

check('stats HEAD uses the same no-store policy as GET', async () => {
  const api = host()
  const result = await api.call('stats', 'HEAD')
  assert.equal(result.status, 200)
  assert.equal(result.headers.get('cache-control'), 'no-store')
  assert.equal(await result.text(), '')
})

check('calendar renders all 730 supported days including the newest day', () => {
  const end = '2026-11-03'
  const start = shiftDay(end, -729)
  const calendar = client.buildCalendar({ start, end, days: [{ date: end, tokens: 9, sessions: 1 }] })
  const inside = calendar.columns.flat().filter((cell) => cell.inside)
  assert.equal(inside.length, 730)
  assert.equal(inside.at(-1).key, end)
  assert.equal(calendar.total, 9)
})

check('calendar rejects impossible dates and ignores out-of-window tokens', () => {
  assert.equal(client.buildCalendar({ start: '2026-02-30', end: '2026-03-02', days: [] }).columns.length, 0)
  const calendar = client.buildCalendar({ start: '2026-11-03', end: '2026-11-04', days: [
    { date: '2026-11-02', tokens: 100 }, { date: '2026-11-03', tokens: 5 }, { date: '2026-11-05', tokens: 200 },
  ] })
  assert.equal(calendar.total, 5)
  assert.equal(client.aggregateCells(calendar, 'cumulative').max, 5)
})

check('local calendar remains complete across DST changes in three time zones', () => {
  const previousZone = process.env.TZ
  try {
    for (const zone of ['America/New_York', 'Europe/Berlin', 'Asia/Shanghai']) {
      process.env.TZ = zone
      const calendar = client.buildCalendar({ start: '2026-01-01', end: '2026-12-31', days: [] })
      const inside = calendar.columns.flat().filter((cell) => cell.inside)
      assert.equal(inside.length, 365, zone)
      assert.equal(new Set(inside.map((cell) => cell.key)).size, 365, `${zone}: unique days`)
      assert.equal(inside.at(-1).key, '2026-12-31', zone)
      for (const column of calendar.columns) assert.equal(column[0].date.getDay(), 1, `${zone}: Monday first`)
      assert.equal(shiftDay('2026-03-08', 1), '2026-03-09', zone)
      assert.equal(shiftDay('2026-11-01', -1), '2026-10-31', zone)
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ
    else process.env.TZ = previousZone
  }
})

check('weekly tooltips consistently name the Monday starting the column', () => {
  const run = runner(client.Heatmap, { activity: { start: '2026-11-02', end: '2026-11-08', days: [{ date: '2026-11-02', tokens: 10 }] }, mode: 'weekly', onMode() {}, t, locale: 'en' })
  const labels = nodes(run.render(), (node) => node.props['data-interactive'] === 'true').map((node) => node.props['aria-label'])
  assert.equal(labels.length, 7)
  assert.equal(new Set(labels).size, 1)
  run.unmount()
})

check('a positive sub-second duration never displays as 0s', () => {
  assert.equal(client.formatDuration(1, t), '1s')
})

check('StrictMode remount cancels old request and ignores its late response', async () => {
  const requests = []
  globalThis.fetch = (_url, init) => { const item = { ...deferred(), init }; requests.push(item); return item.promise }
  const run = runner()
  run.render()
  run.restartEffects()
  assert.equal(requests.length, 2)
  assert.equal(requests[0].init.signal?.aborted, true)
  requests[1].resolve(response('Newest'))
  await flush()
  assert.equal(run.stateValue().data.profile.name, 'Newest')
  requests[0].resolve(response('Stale'))
  await flush()
  assert.equal(run.stateValue().data.profile.name, 'Newest')
  run.unmount()
  assert.equal(run.lateWrites(), 0)
})

check('retry is disabled in flight and duplicate clicks issue one request', async () => {
  const requests = []
  globalThis.fetch = (_url, init) => { const item = { ...deferred(), init }; requests.push(item); return item.promise }
  const run = runner()
  run.render()
  requests[0].reject(new Error('offline'))
  await flush()
  let tree = run.render()
  const retry = buttons(tree).find((button) => button.children.includes(t('retry')))
  assert.ok(retry)
  retry.props.onClick()
  retry.props.onClick()
  tree = run.render()
  assert.equal(requests.length, 2)
  assert.equal(buttons(tree).every((button) => button.props.disabled), true)
  requests[1].resolve(response('Recovered'))
  await flush()
  assert.equal(run.stateValue().status, 'ready')
  run.unmount()
})

check('failed refresh retains good data and displays a visible failure', async () => {
  globalThis.fetch = async () => response('Cached')
  const run = runner()
  run.render()
  await flush()
  let tree = run.render()
  globalThis.fetch = async () => { throw new Error('offline') }
  buttons(tree)[0].props.onClick()
  await flush()
  tree = run.render()
  assert.equal(run.stateValue().data.profile.name, 'Cached')
  assert.ok(nodes(tree, (node) => node.props.role === 'alert').length > 0)
  run.unmount()
})

check('invalid successful response is rejected instead of rendering empty statistics', async () => {
  globalThis.fetch = async () => ({ ok: true, json: async () => ({}) })
  const run = runner()
  run.render()
  await flush()
  assert.equal(run.stateValue().status, 'error')
  run.unmount()
})

check('client timeout exits loading and unmount aborts pending requests', async () => {
  const originalSetTimeout = globalThis.setTimeout
  const originalClearTimeout = globalThis.clearTimeout
  const timers = new Map()
  let nextTimer = 1
  globalThis.setTimeout = (callback) => { const id = nextTimer++; timers.set(id, callback); return id }
  globalThis.clearTimeout = (id) => timers.delete(id)
  try {
    let signal
    globalThis.fetch = (_url, init) => { signal = init.signal; return new Promise(() => {}) }
    const run = runner()
    run.render()
    assert.equal(timers.size, 1, 'every request has a deadline')
    for (const callback of [...timers.values()]) callback()
    await flush()
    assert.equal(signal.aborted, true)
    assert.equal(run.stateValue().status, 'error')
    assert.equal(timers.size, 0)
    run.unmount()

    const pending = runner()
    pending.render()
    pending.unmount()
    await flush()
    assert.equal(signal.aborted, true)
    assert.equal(timers.size, 0)
    assert.equal(pending.lateWrites(), 0)
  } finally {
    globalThis.setTimeout = originalSetTimeout
    globalThis.clearTimeout = originalClearTimeout
  }
})

check('avatar rejects unsupported types and oversized files before decoding', async () => {
  const controller = new AbortController()
  await assert.rejects(client.prepareAvatar({ type: 'image/svg+xml', size: 10 }, controller.signal), error => error.avatarKey === 'avatarTypeError')
  await assert.rejects(client.prepareAvatar({ type: 'image/png', size: 10 * 1024 * 1024 + 1 }, controller.signal), error => error.avatarKey === 'avatarSizeError')
})

check('avatar crops the center into a bounded square PNG and releases decoded pixels', async () => {
  const priorDocument = globalThis.document, priorDecode = globalThis.createImageBitmap
  const drawn = []; let closed = 0
  const canvas = { getContext: () => ({ drawImage: (...args) => drawn.push(args) }), toBlob: callback => callback(new Blob(['png'], { type: 'image/png' })) }
  globalThis.document = { createElement: tag => { assert.equal(tag, 'canvas'); return canvas } }
  globalThis.createImageBitmap = async () => ({ width: 1200, height: 800, close: () => closed++ })
  try {
    const png = await client.prepareAvatar({ type: 'image/jpeg', size: 2000 }, new AbortController().signal)
    assert.equal(png.type, 'image/png'); assert.equal(canvas.width, 512); assert.equal(canvas.height, 512)
    assert.deepEqual(drawn[0].slice(1), [200, 0, 800, 800, 0, 0, 512, 512]); assert.equal(closed, 1)
  } finally { globalThis.document = priorDocument; globalThis.createImageBitmap = priorDecode }
})

check('avatar cancelled while decoding releases a late bitmap without drawing or uploading', async () => {
  const prior = globalThis.createImageBitmap, decode = deferred(); let closed = 0
  globalThis.createImageBitmap = () => decode.promise
  try {
    const controller = new AbortController(), pending = client.prepareAvatar({ type: 'image/png', size: 20 }, controller.signal)
    controller.abort(); decode.resolve({ width: 32, height: 32, close: () => closed++ })
    await assert.rejects(pending); assert.equal(closed, 1)
  } finally { globalThis.createImageBitmap = prior }
})

const identityProps = onAvatarChange => ({ profile: { avatarUrl: '/avatar?v=old', customAvatar: true }, name: 'Test', monogram: 'T', subtitle: '', t, onAvatarChange })
check('avatar reset uses the authenticated DELETE and immediately publishes its descriptor', async () => {
  const changes = [], calls = []
  globalThis.fetch = async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => ({ ok: true, profile: { avatarUrl: '/avatar?v=default', customAvatar: false } }) } }
  const run = runner(client.Identity, identityProps(next => changes.push(next)))
  const reset = buttons(run.render()).find(button => button.children.includes(t('avatarReset')))
  reset.props.onClick(); await flush(); run.render()
  assert.equal(calls.length, 1); assert.equal(calls[0].init.method, 'DELETE'); assert.equal(calls[0].init.credentials, 'same-origin')
  assert.equal(changes[0].customAvatar, false); assert.equal(run.stateValue(), false); run.unmount()
})

check('avatar persistence failure keeps the prior image and exposes a retryable error', async () => {
  const changes = []
  globalThis.fetch = async () => ({ ok: false, json: async () => ({ ok: false }) })
  const run = runner(client.Identity, identityProps(next => changes.push(next)))
  buttons(run.render()).find(button => button.children.includes(t('avatarReset'))).props.onClick()
  await flush(); const tree = run.render()
  assert.equal(changes.length, 0); assert.ok(nodes(tree, node => node.props.role === 'alert').length); assert.equal(run.stateValue(), false); run.unmount()
})

check('avatar unmount aborts the mutation and never publishes a late result', async () => {
  const pending = deferred(); let signal; const changes = []
  globalThis.fetch = (_url, init) => { signal = init.signal; return pending.promise }
  const run = runner(client.Identity, identityProps(next => changes.push(next)))
  buttons(run.render()).find(button => button.children.includes(t('avatarReset'))).props.onClick()
  run.unmount(); assert.equal(signal.aborted, true)
  pending.resolve({ ok: true, json: async () => ({ ok: true, profile: { avatarUrl: '/late', customAvatar: false } }) }); await flush()
  assert.equal(changes.length, 0); assert.equal(run.lateWrites(), 0)
})

check('a refresh started before avatar save cannot restore stale avatar metadata', async () => {
  globalThis.fetch = async () => response('Account')
  const run = runner(); run.render(); await flush(); let tree = run.render()
  const pending = deferred(); globalThis.fetch = () => pending.promise
  buttons(tree)[0].props.onClick()
  nodes(tree, node => node.type === client.Identity)[0].props.onAvatarChange({ avatarUrl: '/avatar?v=new', customAvatar: true })
  pending.resolve({ ok: true, json: async () => ({ ...sample('Updated account'), profile: { name: 'Updated account', avatarUrl: '/avatar?v=old', customAvatar: false } }) })
  await flush(); tree = run.render()
  const profile = nodes(tree, node => node.type === client.Identity)[0].props.profile
  assert.equal(profile.avatarUrl, '/avatar?v=new'); assert.equal(profile.customAvatar, true); assert.equal(profile.name, 'Updated account'); run.unmount()
})

let failures = 0
for (const { label, fn } of cases) {
  try { await fn(); console.log(`ok   ${label}`) }
  catch (error) { failures += 1; console.error(`FAIL ${label}\n     ${error.message}`) }
}
console.log(`\n${cases.length - failures}/${cases.length} profile regressions passed`)
if (failures) process.exitCode = 1
