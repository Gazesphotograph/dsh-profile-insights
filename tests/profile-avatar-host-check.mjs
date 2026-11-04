// Independent Host regressions. All durable fixture writes stay in a verified
// temporary directory; the real profile and packaged avatar are never changed.
// Run: node tests/profile-avatar-host-check.mjs
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { crc32, deflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { apply, ROUTE_PREFIX, foldSession, aggregate } from '../index.js'

const root = await mkdtemp(join(tmpdir(), 'dsh-profile-avatar-host-check-'))
assert.equal(dirname(root), resolve(tmpdir()))
assert.ok(basename(root).startsWith('dsh-profile-avatar-host-check-'))
const safe = (path) => { assert.ok(resolve(path).startsWith(root + sep)); return path }
const originalEnv = { DSH_PROFILE_DIR: process.env.DSH_PROFILE_DIR, DSH_HOME: process.env.DSH_HOME }
const packagedPath = new URL('../avatar.png', import.meta.url)
const packagedBytes = await readFile(packagedPath)
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex').slice(0, 20)
const defaultUrl = `${ROUTE_PREFIX}/avatar?v=${hash(packagedBytes)}`
const cases = []
const check = (label, fn) => cases.push({ label, fn })
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes }); return { promise, resolve } }
const flush = async () => { for (let index = 0; index < 12; index += 1) await Promise.resolve() }
let serial = 0

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data])
  const length = Buffer.alloc(4)
  const checksum = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  checksum.writeUInt32BE(crc32(body) >>> 0)
  return Buffer.concat([length, body, checksum])
}
function png({ side = 512, width = side, height = side, pixel = 32, raster, compressed } = {}) {
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width, 0)
  header.writeUInt32BE(height, 4)
  header[8] = 8
  header[9] = 6
  if (raster === undefined) {
    raster = Buffer.alloc((width * 4 + 1) * height, pixel)
    for (let row = 0; row < height; row += 1) raster[row * (width * 4 + 1)] = 0
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header),
    chunk('IDAT', compressed ?? deflateSync(raster)), chunk('IEND', Buffer.alloc(0)),
  ])
}
const imageA = png()
const imageB = png({ pixel: 96 })

function host({ profileDir = join(root, `profile-${++serial}`), noProfile = false, listSessions } = {}) {
  const routes = new Map()
  let reads = 0
  const ctx = {
    effect(fn) { return fn() },
    logger: { warn() {} },
    get(name) {
      if (name === 'profileContext') return noProfile ? undefined : { dir: profileDir }
      if (name === 'connection') return { fetch: { register(route) {
        assert.equal(typeof route, 'object', 'Connection accepts a route object')
        assert.equal(typeof route.fetch, 'function')
        assert.equal(route.requestBody, 'buffered')
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      } } }
      return undefined
    },
    sessionQuery: {
      async listSessions() { reads += 1; return listSessions ? listSessions() : [] },
      async readSession() { throw new Error('empty corpus') },
    },
  }
  apply(ctx, { cacheTtlMs: 60_000 })
  const call = (endpoint, method = 'GET', body, headers = {}) => {
    const route = routes.get(`${ROUTE_PREFIX}/${endpoint}`)
    assert.ok(route.methods.includes(method))
    const init = { method, headers }
    if (body !== undefined) { init.body = body; init.duplex = 'half' }
    return route.fetch(new Request(`http://local${ROUTE_PREFIX}/${endpoint}`, init))
  }
  return {
    routes, profileDir, reads: () => reads,
    path: join(profileDir, 'profile-insights', 'avatar.png'),
    call,
    upload: (bytes = imageA, headers = { 'content-type': 'image/png' }) => call('avatar', 'POST', bytes, headers),
    stats: async (endpoint = 'stats') => (await call(endpoint, endpoint === 'refresh' ? 'POST' : 'GET')).json(),
  }
}
async function bodyOf(response, status = 200) {
  assert.equal(response.status, status)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  return response.json()
}
async function errorOf(response, status, code) {
  const body = await bodyOf(response, status)
  assert.equal(body.ok, false)
  assert.equal(body.error.code, code)
  assert.equal(typeof body.error.message, 'string')
}

check('four-method route and default descriptor/GET/HEAD use no-store', async () => {
  const api = host()
  assert.deepEqual(api.routes.get(`${ROUTE_PREFIX}/avatar`).methods, ['GET', 'HEAD', 'POST', 'DELETE'])
  const stats = await api.stats()
  assert.deepEqual({ avatarUrl: stats.profile.avatarUrl, customAvatar: stats.profile.customAvatar }, { avatarUrl: defaultUrl, customAvatar: false })
  const image = await api.call('avatar')
  assert.equal(image.status, 200)
  assert.equal(image.headers.get('content-type'), 'image/png')
  assert.equal(image.headers.get('cache-control'), 'no-store')
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), packagedBytes)
  const head = await api.call('avatar', 'HEAD')
  assert.equal(head.headers.get('cache-control'), 'no-store')
  assert.equal(head.headers.get('content-length'), String(packagedBytes.length))
  assert.equal(await head.text(), '')
})

check('upload commits exact bytes atomically and survives a fresh Host instance', async () => {
  const api = host()
  const body = await bodyOf(await api.upload())
  assert.deepEqual(body, { ok: true, profile: { avatarUrl: `${ROUTE_PREFIX}/avatar?v=${hash(imageA)}`, customAvatar: true } })
  assert.deepEqual(await readFile(api.path), imageA)
  assert.deepEqual(await readdir(dirname(api.path)), ['avatar.png'], 'no temporary files survive success')
  const restarted = host({ profileDir: api.profileDir })
  assert.equal((await restarted.stats()).profile.avatarUrl, body.profile.avatarUrl)
  assert.equal((await restarted.stats()).profile.customAvatar, true)
  assert.deepEqual(Buffer.from(await (await restarted.call('avatar')).arrayBuffer()), imageA)
  await bodyOf(await restarted.upload(imageB))
  assert.deepEqual(await readFile(api.path), imageB, 'an existing avatar is replaced')
})

check('1px and 300px square PNGs are accepted without upscaling', async () => {
  const api = host()
  for (const side of [1, 300]) {
    const bytes = png({ side })
    const uploaded = await bodyOf(await api.upload(bytes))
    assert.equal(uploaded.profile.customAvatar, true)
    assert.equal(uploaded.profile.avatarUrl, `${ROUTE_PREFIX}/avatar?v=${hash(bytes)}`)
    assert.deepEqual(await readFile(api.path), bytes)
    assert.deepEqual(Buffer.from(await (await api.call('avatar')).arrayBuffer()), bytes)
  }
})

check('reset removes persistent state, restores packaged bytes, and is idempotent', async () => {
  const api = host()
  await bodyOf(await api.upload())
  const reset = await bodyOf(await api.call('avatar', 'DELETE'))
  assert.deepEqual(reset, { ok: true, profile: { avatarUrl: defaultUrl, customAvatar: false } })
  await assert.rejects(readFile(api.path), { code: 'ENOENT' })
  assert.deepEqual(Buffer.from(await (await api.call('avatar')).arrayBuffer()), packagedBytes)
  assert.equal((await bodyOf(await api.call('avatar', 'DELETE'))).profile.customAvatar, false)
  assert.equal((await host({ profileDir: api.profileDir }).stats()).profile.customAvatar, false)
})

check('invalid MIME, signature, dimensions, chunks and raster preserve a valid avatar', async () => {
  const api = host()
  const accepted = await bodyOf(await api.upload())
  await errorOf(await api.upload(imageB, { 'content-type': 'image/jpeg' }), 415, 'AVATAR_UNSUPPORTED_TYPE')
  await errorOf(await api.upload(Buffer.from('not a png')), 400, 'AVATAR_INVALID_PNG')
  await errorOf(await api.upload(png({ width: 512, height: 256 })), 400, 'AVATAR_INVALID_DIMENSIONS')
  await errorOf(await api.upload(png({ side: 513 })), 400, 'AVATAR_INVALID_DIMENSIONS')
  await errorOf(await api.upload(png({ side: 0 })), 400, 'AVATAR_INVALID_DIMENSIONS')
  await errorOf(await api.upload(imageB.subarray(0, imageB.length - 1)), 400, 'AVATAR_INVALID_PNG')
  const badCrc = Buffer.from(imageB)
  badCrc[badCrc.length - 1] ^= 1
  await errorOf(await api.upload(badCrc), 400, 'AVATAR_INVALID_PNG')
  await errorOf(await api.upload(png({ compressed: Buffer.from('not zlib') })), 400, 'AVATAR_INVALID_PNG')
  await errorOf(await api.upload(png({ raster: Buffer.alloc((512 * 4 + 1) * 512 + 1) })), 400, 'AVATAR_INVALID_PNG')
  const badFilter = Buffer.alloc((512 * 4 + 1) * 512)
  badFilter[0] = 5
  await errorOf(await api.upload(png({ raster: badFilter })), 400, 'AVATAR_INVALID_PNG')
  assert.equal((await api.stats()).profile.avatarUrl, accepted.profile.avatarUrl)
  assert.deepEqual(await readFile(api.path), imageA)
  await bodyOf(await api.upload(imageB), 200)
})

check('2 MiB limit applies to Content-Length and unannounced streaming bodies', async () => {
  const api = host()
  await errorOf(await api.upload(imageA, { 'content-type': 'image/png', 'content-length': String(2 * 1024 * 1024 + 1) }), 413, 'AVATAR_TOO_LARGE')
  let cancelled = false
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1)) },
    cancel() { cancelled = true },
  })
  await errorOf(await api.upload(stream), 413, 'AVATAR_TOO_LARGE')
  assert.equal(cancelled, true, 'oversized stream stops being consumed')
  await assert.rejects(readFile(api.path), { code: 'ENOENT' })
  assert.equal((await api.stats()).profile.customAvatar, false)
})

check('profileContext wins over DSH_PROFILE_DIR, then DSH_HOME supplies fallback', async () => {
  try {
    process.env.DSH_PROFILE_DIR = join(root, 'env-profile')
    process.env.DSH_HOME = join(root, 'env-home')
    const preferred = host({ profileDir: join(root, 'context-profile') })
    await bodyOf(await preferred.upload())
    assert.deepEqual(await readFile(preferred.path), imageA)
    await assert.rejects(readFile(join(process.env.DSH_PROFILE_DIR, 'profile-insights', 'avatar.png')), { code: 'ENOENT' })
    const envProfile = host({ noProfile: true })
    await bodyOf(await envProfile.upload())
    assert.deepEqual(await readFile(join(process.env.DSH_PROFILE_DIR, 'profile-insights', 'avatar.png')), imageA)
    delete process.env.DSH_PROFILE_DIR
    const envHome = host({ noProfile: true })
    await bodyOf(await envHome.upload(imageB))
    assert.deepEqual(await readFile(join(process.env.DSH_HOME, 'profile-insights', 'avatar.png')), imageB)
  } finally {
    for (const [key, value] of Object.entries(originalEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value
  }
})

check('cache and shared inflight statistics attach the latest committed descriptor', async () => {
  const cached = host()
  await cached.stats()
  const uploaded = await bodyOf(await cached.upload())
  assert.equal((await cached.stats()).profile.avatarUrl, uploaded.profile.avatarUrl)
  assert.equal(cached.reads(), 1, 'avatar updates do not require an expensive statistics refresh')
  await bodyOf(await cached.call('avatar', 'DELETE'))
  assert.equal((await cached.stats()).profile.customAvatar, false)
  assert.equal(cached.reads(), 1)

  const gate = deferred()
  const api = host({ listSessions: () => gate.promise })
  const pendingStats = api.stats()
  const pendingRefresh = api.stats('refresh')
  const current = await bodyOf(await api.upload(imageB))
  gate.resolve([])
  const [stats, refresh] = await Promise.all([pendingStats, pendingRefresh])
  assert.equal(api.reads(), 1, 'stats and refresh shared one corpus collection')
  assert.equal(stats.profile.avatarUrl, current.profile.avatarUrl)
  assert.equal(refresh.profile.avatarUrl, current.profile.avatarUrl)
})

check('mutations serialize in call order and a GET waits for the queued reset', async () => {
  const api = host()
  let streamController
  const stream = new ReadableStream({ start(controller) { streamController = controller } })
  const first = api.upload(stream)
  let resetSettled = false
  const second = api.call('avatar', 'DELETE').then((result) => { resetSettled = true; return result })
  const image = api.call('avatar')
  await flush()
  assert.equal(resetSettled, false, 'reset cannot overtake an upload that is still receiving bytes')
  streamController.enqueue(imageA)
  streamController.close()
  assert.equal((await bodyOf(await first)).profile.customAvatar, true)
  assert.equal((await bodyOf(await second)).profile.customAvatar, false)
  assert.deepEqual(Buffer.from(await (await image).arrayBuffer()), packagedBytes)
  const resetAgain = api.call('avatar', 'DELETE')
  const last = api.upload(imageB)
  await bodyOf(await resetAgain)
  assert.equal((await bodyOf(await last)).profile.customAvatar, true)
  assert.deepEqual(await readFile(api.path), imageB)
})

check('write/reset failures never report success or change the in-memory descriptor', async () => {
  const api = host()
  const accepted = await bodyOf(await api.upload())
  const backup = join(dirname(api.path), 'previous-avatar.backup')
  await rename(safe(api.path), safe(backup))
  await mkdir(api.path)
  await errorOf(await api.upload(imageB), 500, 'AVATAR_WRITE_FAILED')
  assert.equal((await api.stats()).profile.avatarUrl, accepted.profile.avatarUrl)
  assert.deepEqual(Buffer.from(await (await api.call('avatar')).arrayBuffer()), imageA)
  assert.equal((await readdir(dirname(api.path))).some((file) => file.endsWith('.tmp')), false)
  await errorOf(await api.call('avatar', 'DELETE'), 500, 'AVATAR_RESET_FAILED')
  assert.equal((await api.stats()).profile.customAvatar, true)
  await rm(safe(api.path), { recursive: true })
  await rename(safe(backup), safe(api.path))
  await bodyOf(await api.upload(imageB))
  assert.deepEqual(await readFile(api.path), imageB, 'mutation queue recovers after filesystem failures')
})

check('a corrupt stored avatar falls back without altering the package and can be replaced', async () => {
  const api = host()
  await mkdir(dirname(api.path), { recursive: true })
  await writeFile(api.path, 'corrupt persisted image')
  assert.equal((await api.stats()).profile.customAvatar, false)
  assert.deepEqual(Buffer.from(await (await api.call('avatar')).arrayBuffer()), packagedBytes)
  await bodyOf(await api.upload(imageA))
  assert.equal((await api.stats()).profile.customAvatar, true)
  assert.deepEqual(await readFile(packagedPath), packagedBytes, 'packaged avatar remains unchanged')
})

check('models merge case/trim aliases across providers before ranking, retaining versions/namespaces', () => {
  const folded = foldSession([], { id: 'models' })
  folded.models = new Map([
    ['p1/ Model-X ', 4], ['p2/model-x', 3], ['p3/MODEL-X', 2],
    ['p1/model-x-v2', 8], ['p1/model-x:latest', 7], ['p1/vendor/model-x', 6],
    ['p1/model-x-2026-11', 5], ['p1/model-x-fast', 4],
  ])
  const options = { today: '2026-11-03', activityDays: 365, topModels: 2, topTools: 8, totalSkills: 0, profile: {}, skippedSessions: 0 }
  const ranked = aggregate([folded], options).insights.models
  assert.equal(ranked.length, 2)
  assert.equal(ranked[0].model.toLowerCase(), 'model-x')
  assert.equal(ranked[0].requests, 9)
  assert.deepEqual(ranked[0].providers, ['p1', 'p2', 'p3'])
  assert.equal(ranked[1].model, 'model-x-v2')
  const all = aggregate([folded], { ...options, topModels: 20 }).insights.models
  assert.equal(all.length, 6)
  assert.equal(new Set(all.map((row) => row.model.toLowerCase())).size, 6)
  assert.ok(all.some((row) => row.model === 'vendor/model-x'))
  assert.ok(all.some((row) => row.model === 'model-x:latest'))
  assert.ok(all.some((row) => row.model === 'model-x-2026-11'))
  assert.ok(all.some((row) => row.model === 'model-x-fast'))
  assert.equal(all.reduce((total, row) => total + row.requests, 0), 39)
})

let failures = 0
try {
  for (const { label, fn } of cases) {
    try { await fn(); console.log(`ok   ${label}`) }
    catch (error) { failures += 1; console.error(`FAIL ${label}\n${error.stack}`) }
  }
  assert.deepEqual(await readFile(packagedPath), packagedBytes)
} finally {
  for (const [key, value] of Object.entries(originalEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value
  assert.equal(dirname(root), resolve(tmpdir()))
  assert.ok(basename(root).startsWith('dsh-profile-avatar-host-check-'))
  await rm(root, { recursive: true, force: true })
}
console.log(`\n${cases.length - failures}/${cases.length} avatar/model Host checks passed`)
if (failures) process.exitCode = 1
