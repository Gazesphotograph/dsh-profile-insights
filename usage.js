import { readFile, mkdir, writeFile, rename, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const PRICE_URL = 'https://models.dev/api.json'
const DAY = 86_400_000
const MAX_BYTES = 32 * 1024 * 1024
const fields = ['input', 'output', 'cache_read', 'cache_write']
const keys = ['input', 'output', 'cacheRead', 'cacheWrite']
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v)
const rate = v => typeof v === 'number' && Number.isFinite(v) && v >= 0
const normal = v => String(v ?? '').trim().toLowerCase()
export const priceKey = (provider, model) => JSON.stringify([provider, model])

export function compactCatalog(raw) {
  if (!record(raw)) throw new Error('Invalid price catalog')
  const rows = []
  for (const [provider, p] of Object.entries(raw)) {
    for (const [id, model] of Object.entries(p?.models ?? {})) {
      if (!record(model?.cost) || !fields.some(f => rate(model.cost[f]))) continue
      rows.push({ provider, id, canonical: model.canonical_model_id, cost: model.cost })
    }
  }
  if (!rows.length) throw new Error('Empty price catalog')
  return rows
}

/** Exact IDs/canonical IDs only. Never strip fast/max/auto or dated suffixes. */
export function createPricer(rows, overrides = {}) {
  const byProvider = new Map(), byName = new Map()
  for (const row of rows) {
    byProvider.set(normal(row.provider) + '/' + normal(row.id), row)
    for (const id of new Set([normal(row.id), normal(row.canonical), normal(row.canonical).split('/').slice(1).join('/')].filter(Boolean))) {
      if (!byName.has(id)) byName.set(id, [])
      byName.get(id).push(row)
    }
  }
  return (provider, model) => {
    const own = overrides[priceKey(provider, model)]
    if (own) return { provider, id: model, cost: own, source: 'custom' }
    const p = normal(provider), m = normal(model)
    const direct = byProvider.get(p + '/' + m) ?? (m.startsWith(p + '/') ? byProvider.get(m) : undefined)
    if (direct && !/plan|subscription/.test(direct.provider)) return { ...direct, source: 'catalog' }
    // Local gateway namespaces (codex/, anyrouter/, deepseek-ai/) are routing,
    // not an assertion that a reseller's tariff is the maker's actual invoice.
    const bare = m.slice(m.lastIndexOf('/') + 1)
    const candidates = [...new Set([...(byName.get(m) ?? []), ...(byName.get(bare) ?? [])])]
    const makers = candidates.filter(r => !/plan|subscription/.test(r.provider)
      && normal(r.canonical).startsWith(normal(r.provider) + '/')
      && (r.cost.input > 0 || r.cost.output > 0))
    if (makers.length && makers.every(r => JSON.stringify(r.cost) === JSON.stringify(makers[0].cost))) {
      return { ...makers[0], source: 'list-estimate' }
    }
    return undefined
  }
}

/** All four Harness counters are disjoint; reasoning is already in output. */
export function costOf(tokens, price) {
  if (!price) return null
  let cost = price.cost
  const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite
  const tiers = (cost.tiers ?? []).filter(t => t.tier?.type === 'context' && rate(t.tier.size))
    .sort((a, b) => a.tier.size - b.tier.size)
  for (const tier of tiers) if (prompt > tier.tier.size) cost = { ...cost, ...tier }
  // Older models.dev entries express their long-context tier under this key.
  if (!tiers.length && prompt > 200_000 && record(cost.context_over_200k)) cost = { ...cost, ...cost.context_over_200k }
  let total = 0
  for (let i = 0; i < keys.length; i++) {
    if (!(tokens[keys[i]] > 0)) continue
    if (!rate(cost[fields[i]])) return null
    total += tokens[keys[i]] * cost[fields[i]] / 1_000_000
  }
  return Number.isFinite(total) ? total : null
}

export function validateSettings(value) {
  if (!record(value)) throw new Error('Invalid settings')
  const result = { daily: null, monthly: null, warningPercent: 80, overrides: {} }
  for (const key of ['daily', 'monthly']) {
    if (value[key] != null) {
      if (!rate(value[key]) || value[key] <= 0 || value[key] > 1e9) throw new Error('Budget must be positive or unset')
      result[key] = value[key]
    }
  }
  if (value.warningPercent !== undefined) {
    if (!rate(value.warningPercent) || value.warningPercent < 1 || value.warningPercent > 100) throw new Error('Invalid warning threshold')
    result.warningPercent = value.warningPercent
  }
  if (value.overrides !== undefined) {
    if (!record(value.overrides) || Object.keys(value.overrides).length > 500) throw new Error('Invalid custom prices')
    for (const [key, cost] of Object.entries(value.overrides)) {
      const pair = JSON.parse(key)
      if (!Array.isArray(pair) || pair.length !== 2 || !pair.every(v => typeof v === 'string' && v.length < 512) || !record(cost)) throw new Error('Invalid model price')
      const clean = {}
      for (const f of fields) if (cost[f] != null) {
        if (!rate(cost[f]) || cost[f] > 1e9) throw new Error('Price must be nonnegative')
        clean[f] = cost[f]
      }
      if (!rate(clean.input) || !rate(clean.output)) throw new Error('Input/output prices are required')
      result.overrides[key] = clean
    }
  }
  return result
}

async function atomicJson(directory, filename, value) {
  await mkdir(directory, { recursive: true })
  const temporary = join(directory, '.' + randomUUID() + '.tmp')
  try {
    await writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    await rename(temporary, join(directory, filename))
  } finally { await unlink(temporary).catch(() => {}) }
}

export async function readSettingsBody(request) {
  const reader = request.body?.getReader()
  if (!reader) throw new Error('Settings body is required')
  let bytes = 0
  const chunks = []
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > 256 * 1024) throw new Error('Settings are too large')
      chunks.push(Buffer.from(value))
    }
    return validateSettings(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
}

/** Per-profile durable settings and last-good catalog; no conversation leaves the host. */
export function createUsageStore(directory, { fetcher = fetch, bundledUrl = new URL('./prices.snapshot.json', import.meta.url) } = {}) {
  let settings, catalog, loading, mutation = Promise.resolve(), syncing, lastAttempt = 0, lastError = null
  const load = () => loading ??= (async () => {
    try { settings = validateSettings(JSON.parse(await readFile(join(directory, 'usage-settings.json'), 'utf8'))) }
    catch (e) { if (e.code !== 'ENOENT') throw new Error('Saved usage settings could not be read'); settings = validateSettings({}) }
    try {
      const saved = JSON.parse(await readFile(join(directory, 'prices.json'), 'utf8'))
      if (!Array.isArray(saved.rows) || !saved.rows.length || !Number.isFinite(saved.at)) throw new Error('Invalid cached catalog')
      catalog = saved
    } catch { catalog = JSON.parse(await readFile(bundledUrl, 'utf8')) }
  })().catch(e => { loading = undefined; throw e })
  const sync = async () => {
    await load()
    if (syncing) return syncing
    lastAttempt = Date.now()
    syncing = (async () => {
      let response
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000)
      try {
        response = await fetcher(PRICE_URL, { signal: controller.signal, headers: { accept: 'application/json' } })
        if (!response.ok) throw new Error('HTTP ' + response.status)
        const reader = response.body.getReader(), chunks = []
        let size = 0
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            size += value.byteLength
            if (size > MAX_BYTES) throw new Error('Price catalog is too large')
            chunks.push(Buffer.from(value))
          }
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock() }
        const rows = compactCatalog(JSON.parse(Buffer.concat(chunks).toString('utf8')))
        const next = { at: Date.now(), rows }
        await atomicJson(directory, 'prices.json', next)
        catalog = next; lastError = null
      } catch (e) { lastError = e.name === 'AbortError' ? 'Price sync timed out' : String(e.message).slice(0,160); throw e }
      finally { clearTimeout(timer); syncing = undefined }
    })()
    return syncing
  }
  return {
    async snapshot() {
      await load(); await mutation
      if (Date.now() - catalog.at > DAY && Date.now() - lastAttempt > 300_000) void sync().catch(() => {})
      return { settings, rows: catalog.rows, pricing: { url: PRICE_URL, updatedAt: catalog.at, stale: Date.now() - catalog.at > DAY, lastError, models: catalog.rows.length } }
    },
    sync,
    save(value) {
      const pending = mutation.then(async () => {
        await load()
        const next = validateSettings(value)
        await atomicJson(directory, 'usage-settings.json', next)
        settings = next
        return next
      })
      mutation = pending.then(() => {}, () => {})
      return pending
    },
  }
}

const empty = () => ({ tokens: 0, cost: 0, requests: 0, unpriced: 0, unpricedTokens: 0 })
function add(target, sample, amount) {
  const total = sample.tokens.input + sample.tokens.output + sample.tokens.cacheRead + sample.tokens.cacheWrite
  target.tokens += total; target.requests++
  for (const key of keys) target[key] = (target[key] ?? 0) + sample.tokens[key]
  if (amount === null) { target.unpriced++; target.unpricedTokens += total }
  else target.cost += amount
}

export function buildUsage(sessions, snapshot, dayKey, now = Date.now()) {
  const pricer = createPricer(snapshot.rows, snapshot.settings.overrides)
  const totals = empty(), daily = empty(), monthly = empty(), models = new Map(), timeline = new Map()
  const today = dayKey(now), month = today.slice(0, 7)
  const rows = sessions.map(session => {
    const result = { ...empty(), id: session.sessionId, title: session.title, createdAt: session.createdAt, lastAt: session.createdAt, models: [] }
    const seen = new Set()
    for (const sample of session.samples ?? []) {
      const { provider, model, tokens, time } = sample
      const price = pricer(provider, model), amount = costOf(tokens, price)
      const date = dayKey(time), key = priceKey(provider, model)
      let m = models.get(key)
      if (!m) { m = { ...empty(), key, provider, model, price: price ?? null }; models.set(key, m) }
      add(m, sample, amount); add(result, sample, amount); add(totals, sample, amount)
      if (date === today) add(daily, sample, amount)
      if (date.slice(0, 7) === month) add(monthly, sample, amount)
      result.lastAt = Math.max(result.lastAt, time)
      seen.add(key)
      // UTC hour is an unambiguous instant; client groups in the viewer's zone.
      const hour = Math.floor(time / 3_600_000) * 3_600_000
      const tk = session.sessionId + ':' + hour
      if (!timeline.has(tk)) timeline.set(tk, { ...empty(), sessionId: session.sessionId, time: hour })
      add(timeline.get(tk), sample, amount)
    }
    result.models = [...seen]
    return result
  }).sort((a,b) => b.lastAt - a.lastAt)
  const budget = (period, summary) => {
    const limit = snapshot.settings[period]
    const ratio = limit === null ? null : summary.cost / limit
    return { ...summary, limit, remaining: limit === null ? null : Math.max(0, limit - summary.cost), ratio,
      state: ratio === null ? 'unset' : ratio >= 1 ? 'exceeded' : ratio * 100 >= snapshot.settings.warningPercent ? 'warning' : 'normal' }
  }
  return { currency: 'USD', totals, settings: snapshot.settings, pricing: snapshot.pricing,
    budgets: { daily: budget('daily', daily), monthly: budget('monthly', monthly) },
    sessions: rows, models: [...models.values()], timeline: [...timeline.values()].sort((a,b) => a.time - b.time) }
}
