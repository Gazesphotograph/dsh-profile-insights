/**
 * 个人资料与洞察 / Profile & Insights — Host half.
 *
 * ## Why this half exists
 *
 * The dashboard is a browser surface, but every number it shows is derived from
 * the durable Session log, which only the Host can read. So this module owns one
 * read-only aggregation over the complete logical Session corpus and serves it to
 * the connected page over an authenticated route. Usage statistics remain a
 * derived read model. A custom avatar is the only durable plugin state, stored
 * under the active profile rather than in the plugin's packaged files.
 *
 * ## What is folded, and from where
 *
 * `ctx.sessionQuery.listSessions()` enumerates the corpus (live-preferred, so an
 * open Session is read from memory and a cold one from its stored log), then
 * `ctx.sessionQuery.readSession(id)` returns one complete validated event log.
 * One pass per Session produces:
 *
 *   - token totals, from the same `assistant/message` / `assistant/attempt`
 *     usage samples the shipped `tokenUsage` projection folds. The
 *     `llm/retry-started` reset is replicated here because a retried attempt
 *     must add again instead of replacing the abandoned sample. Per-day
 *     attribution needs the event timestamp, which a whole-session projection
 *     cannot supply, so this module folds rather than reading the projection.
 *   - turns, steps, and each turn's wall time (`turn/start` → `turn/end`), which
 *     is what "longest task" means here: one user request to its settlement.
 *   - reasoning effort, provider/model, and tool usage, from `request/header`
 *     and `tool/call`. The `skill` tool's arguments name the explored skill.
 *   - the Session title, from the durable `session/title` event.
 *
 * Everything is bucketed into LOCAL calendar days, matching what the user sees.
 *
 * ## Transport
 *
 * Routes go through `ctx.connection.fetch.register(...)` under the `/api/`
 * prefix, which the browser carrier authenticates before any handler runs (the
 * same pattern the shipped session-log-export and the local file-library bundle
 * use). A bare `webServer.register` path would bypass that admission.
 *
 * ## Deliberate limits
 *
 * - No `Config` export: a plugin that exports `Config` must supply a real
 *   Schemastery schema, which a workspace-linked bundle cannot resolve, and an
 *   invalid schema fails activation. The row's `config` object is merged over
 *   `DEFAULTS` at runtime instead, so every key stays overridable from
 *   `cordis.patch.yml`.
 * - A Session whose log fails to read is skipped and counted in
 *   `diagnostics.skippedSessions` instead of failing the whole response.
 */

import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { inflateSync } from 'node:zlib'
import { fileURLToPath } from 'node:url'

/** Stable Cordis plugin name (the bundle patch row id may differ). */
export const name = 'profile-insights'

/** Hard dependencies: without these the plugin contributes nothing. */
export const inject = ['sessionQuery', 'connection']

/** Route prefix every browser request uses. The carrier owns `/api`. */
export const ROUTE_PREFIX = '/api/dsh-profile-insights'

/** Runtime defaults, overridable through the bundle row's `config`. */
const DEFAULTS = {
  /** How long one aggregated payload stays fresh, in milliseconds. */
  cacheTtlMs: 30_000,
  /** Name shown when no account profile is available. */
  displayName: '',
  /** Calendar days of activity the heatmap covers (including today). */
  activityDays: 365,
  /** Ranked rows returned for models and tools. */
  topModels: 6,
  topTools: 8,
  /** Account profile request budget; the page must not wait on the network. */
  accountTimeoutMs: 2_500,
  /** Optional skill discovery must not stall the usage statistics. */
  skillTimeoutMs: 2_500,
}

// ---------------------------------------------------------------------------
// Calendar helpers — local-time day keys, so "today" matches the user's clock
// ---------------------------------------------------------------------------

/**
 * Format one epoch millisecond value as a local `YYYY-MM-DD` key.
 * @param {number} time epoch milliseconds.
 * @returns {string} the local calendar day.
 */
export function dayKey(time) {
  const date = new Date(time)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * Parse a `YYYY-MM-DD` key as local midnight.
 * @param {string} key day key.
 * @returns {Date} local midnight of that day.
 */
export function parseDayKey(key) {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, month - 1, day)
}

/**
 * Shift a day key by whole local days.
 * @param {string} key day key.
 * @param {number} delta days to add (negative moves back).
 * @returns {string} the shifted day key.
 */
export function shiftDay(key, delta) {
  const date = parseDayKey(key)
  date.setDate(date.getDate() + delta)
  return dayKey(date.getTime())
}

// ---------------------------------------------------------------------------
// One-pass Session fold
// ---------------------------------------------------------------------------

/** An all-zero token bucket. */
function zeroBuckets() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
}

/**
 * The last provider usage sample embedded in one Assistant stream.
 *
 * Version-2 settlements keep usage on `data.usage`; older ones only carry the
 * `usage` stream chunk, so both are checked. The stream is scanned backwards
 * because a retried attempt may have emitted several samples.
 * @param {unknown} stream the `assistant/message` or `assistant/attempt` stream.
 * @returns {{inputTokens?: number, outputTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number} | undefined}
 */
export function lastUsage(stream) {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index -= 1) {
    const record = stream[index]
    if (record === null || typeof record !== 'object') continue
    if (record.type !== 'chunk') continue
    const chunk = record.chunk
    if (chunk === null || typeof chunk !== 'object' || chunk.type !== 'usage') continue
    if (chunk.usage !== null && typeof chunk.usage === 'object') return chunk.usage
  }
  return undefined
}

/**
 * The usage one durable Assistant settlement reports, if any.
 * @param {{type: string, data: Record<string, unknown>}} event settlement event.
 * @returns {Record<string, number> | undefined} the usage sample.
 */
export function usageOf(event) {
  const data = event.data ?? {}
  if (event.type === 'assistant/message' && data.usage !== undefined && data.usage !== null) return data.usage
  if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') return undefined
  return lastUsage(data.stream)
}

/** Invalid provider counters must not poison all totals or serialize as null. */
function tokenCount(value) {
  const count = Number(value)
  return Number.isFinite(count) && count > 0 ? count : 0
}

/** Convert one provider usage sample into this module's bucket names. */
function bucketsFrom(usage) {
  return {
    input: tokenCount(usage.inputTokens),
    output: tokenCount(usage.outputTokens),
    cacheRead: tokenCount(usage.cacheReadTokens),
    cacheWrite: tokenCount(usage.cacheWriteTokens),
  }
}

/** Total tokens in one bucket set (prompt + completion + cache traffic). */
export function bucketTotal(buckets) {
  return buckets.input + buckets.output + buckets.cacheRead + buckets.cacheWrite
}

/** Add one bucket set into another, in place. */
function addBuckets(target, source) {
  target.input += source.input
  target.output += source.output
  target.cacheRead += source.cacheRead
  target.cacheWrite += source.cacheWrite
}

/** Subtract one bucket set from another, in place. */
function subtractBuckets(target, source) {
  target.input -= source.input
  target.output -= source.output
  target.cacheRead -= source.cacheRead
  target.cacheWrite -= source.cacheWrite
}

/** Whether two bucket sets hold identical values. */
function sameBuckets(left, right) {
  return left.input === right.input && left.output === right.output
    && left.cacheRead === right.cacheRead && left.cacheWrite === right.cacheWrite
}

/** Increment one counter in a Map. */
function bump(map, key, amount = 1) {
  if (typeof key !== 'string' || key === '') return
  map.set(key, (map.get(key) ?? 0) + amount)
}

/**
 * Extract the skill name from one `skill` tool call's serialized arguments.
 * @param {unknown} raw the `tool/call` arguments string.
 * @returns {string | undefined} the skill name, when the call names one.
 */
export function skillNameOf(raw) {
  if (typeof raw !== 'string' || raw === '') return undefined
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined
  const candidate = parsed.name ?? parsed.skill ?? parsed.id
  return typeof candidate === 'string' && candidate !== '' ? candidate : undefined
}

/**
 * Fold one Session's complete event log into the aggregates the dashboard needs.
 *
 * The fold is total: an unknown event type, a malformed usage sample, or a
 * missing field is ignored rather than thrown, so one unusual log can never
 * blank the page.
 *
 * @param {readonly Record<string, any>[]} events ascending-seq Session events.
 * @param {{id: string, createdAt?: number}} header the Session header.
 * @returns {{
 *   sessionId: string, createdAt: number, title: string,
 *   tokens: {input: number, output: number, cacheRead: number, cacheWrite: number},
 *   turns: number, steps: number,
 *   days: Map<string, {tokens: number, turns: number}>,
 *   longestTurn: {ms: number, at: number},
 *   effort: Map<string, number>, models: Map<string, number>, tools: Map<string, number>,
 *   skills: Set<string>,
 * }} the folded figures.
 */
export function foldSession(events, header) {
  const tokens = zeroBuckets()
  const days = new Map()
  const effort = new Map()
  const models = new Map()
  const tools = new Map()
  const skills = new Set()
  let turns = 0
  let steps = 0
  let title = ''
  let longestTurn = { ms: 0, at: 0 }
  let openTurnAt = null
  /** The sample awaiting replacement: a retry or a same-step re-settlement. */
  let last = null
  /** Routing carried forward from the latest `request/header`. */
  let currentEffort
  let currentModel

  const dayOf = (time) => {
    const key = dayKey(time)
    let bucket = days.get(key)
    if (bucket === undefined) {
      bucket = { tokens: 0, turns: 0 }
      days.set(key, bucket)
    }
    return bucket
  }

  for (const event of events) {
    if (event === null || typeof event !== 'object') continue
    const data = event.data ?? {}
    switch (event.type) {
      case 'session/title': {
        if (typeof data.title === 'string' && data.title !== '') title = data.title
        break
      }
      case 'turn/start': {
        turns += 1
        openTurnAt = event.time
        dayOf(event.time).turns += 1
        break
      }
      case 'turn/end': {
        if (openTurnAt !== null && Number.isFinite(event.time) && event.time >= openTurnAt) {
          const ms = event.time - openTurnAt
          if (ms > longestTurn.ms) longestTurn = { ms, at: openTurnAt }
        }
        openTurnAt = null
        break
      }
      case 'step/end': {
        steps += 1
        break
      }
      case 'llm/retry-started': {
        if (last !== null && last.turn === data.turn && last.step === data.step) last = null
        break
      }
      case 'request/header': {
        const config = data.header?.config
        if (config !== null && typeof config === 'object') {
          // The header is only re-emitted when routing changes, so it is carried
          // forward and counted per model request below instead of per header.
          currentEffort = config.reasoningEffort === undefined ? 'default' : String(config.reasoningEffort)
          if (typeof config.model === 'string' && config.model !== '') {
            const provider = typeof config.provider === 'string' && config.provider !== '' ? config.provider : 'unknown'
            currentModel = `${provider}/${config.model}`
          }
        }
        break
      }
      case 'tool/call': {
        const toolName = typeof data.name === 'string' ? data.name : ''
        if (toolName !== '') bump(tools, toolName)
        if (toolName === 'skill') {
          const skill = skillNameOf(data.arguments)
          if (skill !== undefined) skills.add(skill)
        }
        break
      }
      case 'assistant/message': {
        // One assembled message is one model request: the honest unit for
        // "which reasoning effort and model do I actually use most".
        if (currentEffort !== undefined) bump(effort, currentEffort)
        if (currentModel !== undefined) bump(models, currentModel)
        const usage = usageOf(event)
        if (usage === undefined) break
        const buckets = bucketsFrom(usage)
        const previous = last !== null && last.turn === data.turn && last.step === data.step ? last : null
        if (previous !== null && sameBuckets(previous.buckets, buckets)) break
        if (previous !== null) {
          // A re-settlement of the same step replaces its earlier sample: the
          // earlier contribution leaves both the totals and its own day.
          subtractBuckets(tokens, previous.buckets)
          const previousDay = days.get(previous.day)
          if (previousDay !== undefined) previousDay.tokens -= bucketTotal(previous.buckets)
        }
        const day = dayKey(event.time)
        addBuckets(tokens, buckets)
        dayOf(event.time).tokens += bucketTotal(buckets)
        last = { turn: data.turn, step: data.step, buckets, day }
        break
      }
      case 'assistant/attempt': {
        const usage = usageOf(event)
        if (usage === undefined) break
        const buckets = bucketsFrom(usage)
        const previous = last !== null && last.turn === data.turn && last.step === data.step ? last : null
        if (previous !== null && sameBuckets(previous.buckets, buckets)) break
        if (previous !== null) {
          subtractBuckets(tokens, previous.buckets)
          const previousDay = days.get(previous.day)
          if (previousDay !== undefined) previousDay.tokens -= bucketTotal(previous.buckets)
        }
        const day = dayKey(event.time)
        addBuckets(tokens, buckets)
        dayOf(event.time).tokens += bucketTotal(buckets)
        last = { turn: data.turn, step: data.step, buckets, day }
        break
      }
      default:
        break
    }
  }

  return {
    sessionId: String(header.id ?? ''),
    createdAt: Number(header.createdAt) || 0,
    title,
    tokens,
    turns,
    steps,
    days,
    longestTurn,
    effort,
    models,
    tools,
    skills,
  }
}

// ---------------------------------------------------------------------------
// Aggregation over every folded Session
// ---------------------------------------------------------------------------

/**
 * Compute the current and longest run of consecutive active days.
 *
 * The current streak counts back from today; when today has no activity yet the
 * count starts at yesterday, so a streak is not reported as broken before the
 * user has had a chance to work.
 *
 * @param {Iterable<string>} activeDays day keys with any activity.
 * @param {string} today today's local day key.
 * @returns {{current: number, longest: number, longestEnd: string}} the streaks.
 */
export function computeStreaks(activeDays, today) {
  const days = new Set(activeDays)
  let current = 0
  let cursor = days.has(today) ? today : shiftDay(today, -1)
  while (days.has(cursor)) {
    current += 1
    cursor = shiftDay(cursor, -1)
  }

  const sorted = [...days].sort()
  let longest = 0
  let longestEnd = ''
  let run = 0
  let previous = null
  for (const key of sorted) {
    run = previous !== null && shiftDay(previous, 1) === key ? run + 1 : 1
    if (run > longest) {
      longest = run
      longestEnd = key
    }
    previous = key
  }
  return { current, longest, longestEnd }
}

/** Merge complete model names across providers before applying the ranking limit. */
export function rankModels(models, limit) {
  const merged = new Map()
  for (const [id, requests] of models) {
    if (!(requests > 0)) continue
    const slash = id.indexOf('/')
    const provider = slash < 0 ? 'unknown' : id.slice(0, slash).trim() || 'unknown'
    const model = (slash < 0 ? id : id.slice(slash + 1)).trim()
    if (model === '') continue
    // Preserve namespaces, versions and suffixes; only case and outer whitespace
    // describe the same model. Provider aliases do not split its usage.
    const key = model.toLowerCase()
    let row = merged.get(key)
    if (row === undefined) {
      row = { key, provider, model, requests: 0, providers: new Set(), representativeRequests: -1 }
      merged.set(key, row)
    }
    row.requests += requests
    row.providers.add(provider)
    if (requests > row.representativeRequests || (requests === row.representativeRequests && model.localeCompare(row.model) < 0)) {
      row.provider = provider
      row.model = model
      row.representativeRequests = requests
    }
  }
  return [...merged.values()]
    .sort((left, right) => right.requests - left.requests || left.key.localeCompare(right.key))
    .slice(0, limit)
    .map(({ provider, model, requests, providers }) => ({ provider, providers: [...providers].sort(), model, requests }))
}

/**
 * Merge folded Sessions into the dashboard payload.
 *
 * @param {readonly ReturnType<typeof foldSession>[]} sessions folded Sessions.
 * @param {{today: string, activityDays: number, topModels: number, topTools: number, totalSkills: number, profile: object, skippedSessions: number}} options
 * @returns {object} the `/stats` response body (without `ok`/`generatedAt`).
 */
export function aggregate(sessions, options) {
  const totalsTokens = zeroBuckets()
  let totalTurns = 0
  let totalSteps = 0
  const dayTotals = new Map()
  const effort = new Map()
  const models = new Map()
  const tools = new Map()
  const skills = new Set()
  let longestTask = { ms: 0, at: 0, sessionId: '', title: '' }

  for (const session of sessions) {
    addBuckets(totalsTokens, session.tokens)
    totalTurns += session.turns
    totalSteps += session.steps
    for (const [key, bucket] of session.days) {
      // Replacing a same-step sample across midnight can leave an empty bucket.
      // It contributes neither an active Session nor a day to the streak.
      if (!(bucket.tokens > 0 || bucket.turns > 0)) continue
      let day = dayTotals.get(key)
      if (day === undefined) {
        day = { tokens: 0, turns: 0, sessions: 0 }
        dayTotals.set(key, day)
      }
      day.tokens += bucket.tokens
      day.turns += bucket.turns
      day.sessions += 1
    }
    for (const [key, count] of session.effort) bump(effort, key, count)
    for (const [key, count] of session.models) bump(models, key, count)
    for (const [key, count] of session.tools) bump(tools, key, count)
    for (const skill of session.skills) skills.add(skill)
    if (session.longestTurn.ms > longestTask.ms) {
      longestTask = {
        ms: session.longestTurn.ms,
        at: session.longestTurn.at,
        sessionId: session.sessionId,
        title: session.title,
      }
    }
  }

  // The heatmap window: `activityDays` local days ending today, inclusive.
  const windowStart = shiftDay(options.today, -(options.activityDays - 1))
  const activity = []
  let peak = { date: '', tokens: 0, sessions: 0 }
  let maxTokens = 0
  let activeDays = 0
  for (const [key, day] of [...dayTotals].sort((left, right) => left[0].localeCompare(right[0]))) {
    if (day.tokens > 0 || day.turns > 0) activeDays += 1
    if (day.tokens > maxTokens) maxTokens = day.tokens
    if (day.tokens > peak.tokens) peak = { date: key, tokens: day.tokens, sessions: day.sessions }
    if (key < windowStart || key > options.today) continue
    activity.push({ date: key, tokens: day.tokens, sessions: day.sessions, turns: day.turns })
  }

  const ranked = (map, limit) => [...map]
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([id, count]) => ({ id, count }))

  const effortRows = [...effort]
    .filter(([, count]) => count > 0)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([id, requests]) => ({ id, requests }))

  const streaks = computeStreaks(dayTotals.keys(), options.today)
  const totalSkillCount = Math.max(0, Number(options.totalSkills) || 0)
  const usedSkillCount = skills.size

  return {
    profile: options.profile,
    totals: {
      sessions: sessions.length,
      turns: totalTurns,
      steps: totalSteps,
      activeDays,
      tokens: {
        input: totalsTokens.input,
        output: totalsTokens.output,
        cacheRead: totalsTokens.cacheRead,
        cacheWrite: totalsTokens.cacheWrite,
        total: bucketTotal(totalsTokens),
      },
    },
    peak,
    longestTask: {
      ms: longestTask.ms,
      at: longestTask.at,
      sessionId: longestTask.sessionId,
      title: longestTask.title,
    },
    streaks,
    activity: {
      start: windowStart,
      end: options.today,
      days: activity,
      maxTokens,
    },
    insights: {
      reasoningEffort: effortRows,
      models: rankModels(models, options.topModels),
      tools: ranked(tools, options.topTools).map(({ id, count }) => ({ name: id, calls: count })),
      skills: {
        used: usedSkillCount,
        total: Math.max(totalSkillCount, usedSkillCount),
        names: [...skills].sort(),
      },
    },
    diagnostics: { skippedSessions: options.skippedSessions },
  }
}

// ---------------------------------------------------------------------------
// Collectors
// ---------------------------------------------------------------------------

/** Bound an optional service call, including synchronous failures. */
async function settleWithin(callback, timeoutMs) {
  const configured = Number(timeoutMs)
  const budget = Number.isFinite(configured) && configured >= 0 ? configured : DEFAULTS.accountTimeoutMs
  let timer
  try {
    return await Promise.race([
      Promise.resolve().then(callback).catch(() => undefined),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(undefined), budget)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/**
 * Resolve the identity shown in the dashboard header.
 *
 * The account profile is a network read, so it is bounded and fully optional: a
 * signed-out or unreachable account falls back to the configured name and then
 * to the OS user, which is what the page would otherwise have to invent.
 *
 * @param {import('cordis').Context} ctx the plugin context.
 * @param {{displayName: string, accountTimeoutMs: number}} config resolved config.
 * @returns {Promise<{name: string, avatarUrl: string, signedIn: boolean}>} the profile block.
 */
async function collectProfile(ctx, config) {
  let name = ''
  let signedIn = false
  const account = ctx.get('deepseekAccount')
  if (account !== undefined && account !== null) {
    const state = await settleWithin(() => account.getState(), config.accountTimeoutMs)
    signedIn = state?.status === 'credential-stored'
    if (signedIn && typeof account.getProfile === 'function') {
      const profile = await settleWithin(() => account.getProfile({
        version: '1.0.0',
        locale: 'zh',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      }), config.accountTimeoutMs)
      const value = profile?.status === 'ready' ? profile.value : undefined
      if (typeof value?.name === 'string' && value.name !== '') name = value.name
    }
  }
  if (name === '' && typeof config.displayName === 'string') name = config.displayName
  if (name === '') name = process.env.USERNAME ?? process.env.USER ?? ''
  if (name === '') name = 'DeepSeek 用户'
  return { name, avatarUrl: `${ROUTE_PREFIX}/avatar`, signedIn }
}

/**
 * Count the skills currently available to the user.
 *
 * Discovery is optional and workspace-sensitive: the most recently used Session
 * directory is the best available stand-in for "the user's workspace".
 * @param {import('cordis').Context} ctx the plugin context.
 * @param {string | undefined} cwd the workspace directory to resolve skills against.
 * @param {number} timeoutMs optional discovery request budget.
 * @returns {Promise<number>} the catalog size, or 0 when discovery is unavailable.
 */
async function collectSkillTotal(ctx, cwd, timeoutMs) {
  const skills = ctx.get('skills')
  if (skills === undefined || skills === null) return 0
  try {
    const list = await settleWithin(() => skills.list(cwd === undefined ? {} : { cwd }), timeoutMs)
    return Array.isArray(list) ? list.length : 0
  } catch {
    return 0
  }
}

/**
 * Read and fold the complete Session corpus.
 * @param {import('cordis').Context} ctx the plugin context.
 * @param {typeof DEFAULTS} config resolved config.
 * @returns {Promise<object>} the `/stats` body without `ok`/`generatedAt`.
 */
async function collect(ctx, config) {
  const sessionQuery = ctx.sessionQuery
  const records = await sessionQuery.listSessions()
  const folded = []
  let skippedSessions = 0
  let newestCwd
  let newestCreatedAt = -1

  for (const record of records) {
    const header = record.header ?? {}
    try {
      const snapshot = await sessionQuery.readSession(header.id)
      const events = Array.isArray(snapshot?.events) ? snapshot.events : []
      folded.push(foldSession(events, snapshot?.session ?? header))
      const createdAt = Number(header.createdAt) || 0
      if (createdAt > newestCreatedAt) {
        newestCreatedAt = createdAt
        if (typeof header.cwd === 'string' && header.cwd !== '') newestCwd = header.cwd
      }
    } catch {
      skippedSessions += 1
    }
  }

  const workingDirectory = ctx.get('workingDirectory')
  const cwd = newestCwd ?? workingDirectory?.defaultDirectory
  const [profile, totalSkills] = await Promise.all([
    collectProfile(ctx, config),
    collectSkillTotal(ctx, cwd, config.skillTimeoutMs),
  ])

  return aggregate(folded, {
    today: dayKey(Date.now()),
    activityDays: Math.max(7, Math.min(730, Number(config.activityDays) || DEFAULTS.activityDays)),
    topModels: Math.max(1, Number(config.topModels) || DEFAULTS.topModels),
    topTools: Math.max(1, Number(config.topTools) || DEFAULTS.topTools),
    totalSkills,
    profile,
    skippedSessions,
  })
}

// ---------------------------------------------------------------------------
// Profile-owned avatar storage
// ---------------------------------------------------------------------------

const AVATAR_MAX_BYTES = 2 * 1024 * 1024
const AVATAR_SIDE = 512
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let crc = value
  for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  return crc >>> 0
})

class AvatarError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

function invalidPng() {
  return new AvatarError(400, 'AVATAR_INVALID_PNG', 'The avatar must be a complete, valid PNG image.')
}

function pngCrc(bytes) {
  let crc = 0xffffffff
  for (const value of bytes) crc = PNG_CRC_TABLE[(crc ^ value) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Validate bounds, PNG chunks/checksums and the bounded decoded raster. */
function validateAvatar(bytes) {
  if (bytes.length > AVATAR_MAX_BYTES) throw new AvatarError(413, 'AVATAR_TOO_LARGE', 'The avatar must be no larger than 2 MiB.')
  if (bytes.length < 57 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) throw invalidPng()
  let header
  let ended = false
  let palette = false
  let idatEnded = false
  const compressed = []
  for (let offset = 8; offset < bytes.length;) {
    if (bytes.length - offset < 12) throw invalidPng()
    const length = bytes.readUInt32BE(offset)
    if (length > bytes.length - offset - 12) throw invalidPng()
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (!/^[A-Za-z]{4}$/.test(type) || pngCrc(bytes.subarray(offset + 4, offset + 8 + length)) !== bytes.readUInt32BE(offset + 8 + length)) throw invalidPng()
    if (offset === 8 && type !== 'IHDR') throw invalidPng()
    if (type === 'IHDR') {
      if (header !== undefined || length !== 13) throw invalidPng()
      const width = data.readUInt32BE(0)
      const height = data.readUInt32BE(4)
      if (width < 1 || width > AVATAR_SIDE || height !== width) throw new AvatarError(400, 'AVATAR_INVALID_DIMENSIONS', 'The avatar must be square, with a side length from 1 to 512 pixels.')
      const depth = data[8]
      const color = data[9]
      const depths = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
      if (!depths[color]?.includes(depth) || data[10] !== 0 || data[11] !== 0 || data[12] > 1) throw invalidPng()
      header = { width, height, depth, channels: { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color], color, interlaced: data[12] === 1 }
    } else if (type === 'PLTE') {
      if (palette || compressed.length > 0 || length === 0 || length % 3 !== 0 || length > 768) throw invalidPng()
      palette = true
    } else if (type === 'IDAT') {
      if (idatEnded || (header.color === 3 && !palette)) throw invalidPng()
      compressed.push(data)
    } else if (type === 'IEND') {
      if (length !== 0 || compressed.length === 0 || offset + 12 !== bytes.length) throw invalidPng()
      ended = true
    } else {
      // Unknown critical chunks change decoding and cannot be safely ignored.
      if (type[0] === type[0].toUpperCase()) throw invalidPng()
      if (compressed.length > 0) idatEnded = true
    }
    offset += length + 12
  }
  if (!ended || header === undefined) throw invalidPng()
  const passes = header.interlaced
    ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]]
    : [[0, 0, 1, 1]]
  const rows = passes.map(([x, y, dx, dy]) => ({
    count: Math.ceil((header.height - y) / dy),
    width: Math.ceil((header.width - x) / dx),
  })).filter((row) => row.count > 0 && row.width > 0)
    .map(({ count, width }) => ({ count, stride: 1 + Math.ceil(width * header.channels * header.depth / 8) }))
  const expected = rows.reduce((total, row) => total + row.count * row.stride, 0)
  let raster
  try {
    raster = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected })
  } catch {
    throw invalidPng()
  }
  if (raster.length !== expected) throw invalidPng()
  let offset = 0
  for (const row of rows) {
    for (let index = 0; index < row.count; index += 1, offset += row.stride) if (raster[offset] > 4) throw invalidPng()
  }
}

function configuredDirectory(value) {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  if (value === '~') return homedir()
  if (/^~[/\\]/.test(value)) return resolve(homedir(), value.slice(2))
  return resolve(value)
}

/** Keep profile data out of package source, including for linked workspace bundles. */
function avatarDirectory(ctx) {
  return join(configuredDirectory(ctx.get('profileContext')?.dir)
    ?? configuredDirectory(process.env.DSH_PROFILE_DIR)
    ?? configuredDirectory(process.env.DSH_HOME)
    ?? join(homedir(), '.dsh'), 'profile-insights')
}

/** Read at most the avatar budget even when Content-Length is absent or false. */
async function avatarBody(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'image/png') {
    throw new AvatarError(415, 'AVATAR_UNSUPPORTED_TYPE', 'Upload the avatar as image/png.')
  }
  if (Number(request.headers.get('content-length')) > AVATAR_MAX_BYTES) {
    throw new AvatarError(413, 'AVATAR_TOO_LARGE', 'The avatar must be no larger than 2 MiB.')
  }
  const reader = request.body?.getReader()
  if (reader === undefined) throw invalidPng()
  const chunks = []
  let total = 0
  let complete = false
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) { complete = true; break }
      total += value.byteLength
      if (total > AVATAR_MAX_BYTES) throw new AvatarError(413, 'AVATAR_TOO_LARGE', 'The avatar must be no larger than 2 MiB.')
      chunks.push(Buffer.from(value))
    }
  } catch (error) {
    if (error instanceof AvatarError) throw error
    throw new AvatarError(400, 'AVATAR_INVALID_BODY', 'The avatar upload could not be read.')
  } finally {
    if (!complete) void reader.cancel().catch(() => {})
    reader.releaseLock()
  }
  const bytes = Buffer.concat(chunks, total)
  validateAvatar(bytes)
  return bytes
}

/** One state object binds served bytes and the content-versioned profile URL. */
function avatarState(bytes, customAvatar) {
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 20)
  return { bytes, profile: { avatarUrl: `${ROUTE_PREFIX}/avatar?v=${hash}`, customAvatar } }
}

function createAvatarStore(ctx) {
  const directory = avatarDirectory(ctx)
  const path = join(directory, 'avatar.png')
  let current
  let loading
  let packaged
  let mutations = Promise.resolve()
  const defaultState = () => packaged ??= readFile(fileURLToPath(new URL('./avatar.png', import.meta.url))).then((bytes) => avatarState(bytes, false))
  const load = async () => {
    if (current !== undefined) return current
    if (loading === undefined) loading = (async () => {
      try {
        const bytes = await readFile(path)
        validateAvatar(bytes)
        return avatarState(bytes, true)
      } catch (error) {
        if (error.code !== 'ENOENT' && !(error instanceof AvatarError)) throw error
        if (error instanceof AvatarError) ctx.logger?.warn?.('profile-insights: ignoring an invalid stored avatar')
        return defaultState()
      }
    })().then((value) => { current = value; return value }).finally(() => { loading = undefined })
    return loading
  }
  const serial = (callback) => {
    const pending = mutations.then(callback)
    mutations = pending.then(() => undefined, () => undefined)
    return pending
  }
  const read = async () => { await mutations; return load() }
  return {
    descriptor: async () => (await read()).profile,
    read,
    upload: (request) => serial(async () => {
      const bytes = await avatarBody(request)
      await load()
      const next = avatarState(bytes, true)
      await mkdir(directory, { recursive: true })
      const temporary = join(directory, `.avatar-${randomUUID()}.tmp`)
      let handle
      let staged = false
      try {
        handle = await open(temporary, 'wx', 0o600)
        staged = true
        await handle.writeFile(bytes)
        await handle.sync()
        await handle.close()
        handle = undefined
        // Rename within this directory atomically replaces the old image. Commit
        // memory only after durable staging and successful replacement.
        await rename(temporary, path)
        staged = false
        current = next
      } finally {
        await handle?.close().catch(() => {})
        if (staged) await unlink(temporary).catch(() => {})
      }
      return next.profile
    }),
    reset: () => serial(async () => {
      await load()
      const next = await defaultState()
      try { await unlink(path) } catch (error) { if (error.code !== 'ENOENT') throw error }
      current = next
      return next.profile
    }),
  }
}

// ---------------------------------------------------------------------------
// Plugin body
// ---------------------------------------------------------------------------

/** One JSON response with the no-store headers a live dashboard wants. */
function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/** One error response in the shape the client already understands. */
function failure(status, code, message) {
  return json(status, { ok: false, error: { code, message } })
}

/**
 * Mount the aggregation routes.
 * @param {import('cordis').Context} ctx the plugin context.
 * @param {Record<string, unknown>} rawConfig the bundle row's `config`.
 */
export function apply(ctx, rawConfig = {}) {
  const config = { ...DEFAULTS, ...(rawConfig ?? {}) }
  const cacheTtlMs = Math.max(0, Number(config.cacheTtlMs) || 0)

  /** @type {{at: number, body: object} | undefined} */
  let cache
  /** @type {Promise<object> | undefined} */
  let inflight

  const payload = async ({ force = false } = {}) => {
    if (!force && cache !== undefined && Date.now() - cache.at < cacheTtlMs) return cache.body
    if (inflight !== undefined) return inflight
    inflight = (async () => {
      try {
        const body = await collect(ctx, config)
        cache = { at: Date.now(), body }
        return body
      } finally {
        inflight = undefined
      }
    })()
    return inflight
  }

  const avatars = createAvatarStore(ctx)
  // Never cache avatar identity inside a statistics generation: an upload can
  // finish while a slow corpus scan or its shared inflight request is pending.
  const withAvatar = async (body) => ({
    ...body,
    profile: { ...body.profile, ...await avatars.descriptor() },
  })

  let warnedNoCarrier = false
  const registerRoute = (route) => {
    const connection = ctx.get('connection')
    if (connection?.fetch?.register === undefined) {
      // One warning for the whole plugin: three routes failing for the same
      // missing service must not triple the log line.
      if (!warnedNoCarrier) {
        warnedNoCarrier = true
        ctx.logger?.warn?.('profile-insights: connection.fetch is unavailable; browser routes are not registered')
      }
      return () => {}
    }
    try {
      return connection.fetch.register(route)
    } catch (error) {
      ctx.logger?.warn?.('profile-insights: route registration failed', error)
      return () => {}
    }
  }

  const disposers = [
    registerRoute({
      path: `${ROUTE_PREFIX}/stats`,
      methods: ['GET', 'HEAD'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = await payload()
          if (request.method === 'HEAD') {
            return new Response(null, {
              status: 200,
              headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
            })
          }
          return json(200, { ok: true, generatedAt: cache?.at ?? Date.now(), ...await withAvatar(body) })
        } catch (error) {
          return failure(500, 'STATS_FAILED', error instanceof Error ? error.message : 'aggregation failed')
        }
      },
    }),
    registerRoute({
      path: `${ROUTE_PREFIX}/refresh`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async () => {
        try {
          const body = await payload({ force: true })
          return json(200, { ok: true, generatedAt: cache?.at ?? Date.now(), ...await withAvatar(body) })
        } catch (error) {
          return failure(500, 'STATS_FAILED', error instanceof Error ? error.message : 'aggregation failed')
        }
      },
    }),
    registerRoute({
      path: `${ROUTE_PREFIX}/avatar`,
      methods: ['GET', 'HEAD', 'POST', 'DELETE'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          if (request.method === 'POST') return json(200, { ok: true, profile: await avatars.upload(request) })
          if (request.method === 'DELETE') return json(200, { ok: true, profile: await avatars.reset() })
          if (request.method !== 'GET' && request.method !== 'HEAD') return failure(405, 'METHOD_NOT_ALLOWED', 'Use GET, HEAD, POST or DELETE.')
          const { bytes } = await avatars.read()
          const headers = {
            'content-type': 'image/png',
            'content-length': String(bytes.byteLength),
            'cache-control': 'no-store',
            'x-content-type-options': 'nosniff',
          }
          return new Response(request.method === 'HEAD' ? null : bytes, { status: 200, headers })
        } catch (error) {
          if (error instanceof AvatarError) return failure(error.status, error.code, error.message)
          const action = request.method === 'POST' ? 'WRITE' : request.method === 'DELETE' ? 'RESET' : 'READ'
          return failure(500, `AVATAR_${action}_FAILED`, 'The avatar could not be saved or read. Please try again.')
        }
      },
    }),
  ]

  ctx.effect(() => () => {
    for (const dispose of disposers) {
      try {
        void dispose()
      } catch {
        // A route carrier that already tore down needs no cleanup.
      }
    }
  }, 'profile-insights: routes')
}
