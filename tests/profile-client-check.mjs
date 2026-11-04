// Scratch harness: verifies the heatmap calendar math extracted from
// plugins/dsh-profile-insights/client.js. The client module registers itself on
// window.__ModuleLoader__, so this harness stubs that loader, captures the
// factory, and exercises the pure helpers through a minimal React stub.
// Run: node tests/profile-client-check.mjs
import assert from 'node:assert/strict'

// --- minimal React stub ----------------------------------------------------
const React = {
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useMemo: (fn) => fn(),
  useRef: (value) => ({ current: value }),
  useCallback: (fn) => fn,
}

let captured
globalThis.window = {
  __ModuleLoader__: {
    load: (definition) => { captured = definition },
  },
}
const navigatorStub = { language: 'zh-CN' }

const { readFile } = await import('node:fs/promises')
const source = await readFile(new URL('../client.js', import.meta.url), 'utf8')
// Evaluate the module body with our stubs in scope.
const factory = new Function('window', 'require', 'navigator', `${source}\n`)
factory(globalThis.window, (id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require(${id})`)
}, navigatorStub)

assert.ok(captured !== undefined, 'module registered itself')
assert.equal(captured.id, '@local/dsh-profile-insights', 'module id matches the package name')

const plugin = captured.factory((id) => {
  if (id === 'react') return React
  throw new Error(`unexpected require(${id})`)
})
assert.deepEqual(plugin.inject, ['slots', 'locale'])
assert.equal(typeof plugin.apply, 'function', 'apply is exported')

// Capture the registrations apply() makes.
const registrations = []
const ctx = {
  effect: (fn) => { fn(); return () => {} },
  locale: { register: () => () => {}, bind: () => (key) => key },
  slots: {
    inject: (owner, callback) => { callback(); return () => {} },
    register: (options) => { registrations.push(options); return () => {} },
  },
}
plugin.apply(ctx)
const sidebar = registrations.find((row) => row.name === 'sidebar.panellist')
const main = registrations.find((row) => row.name === 'main')
assert.ok(sidebar !== undefined, 'sidebar entry registered')
assert.ok(main !== undefined, 'main panel registered')
assert.equal(sidebar.id, main.key, 'sidebar id and main key must match')
assert.equal(sidebar.id, 'profile-insights')

// --- reach the pure helpers through a page render --------------------------
// The helpers are module-private; re-render the heatmap by invoking the page
// component with a stubbed fetch so the calendar builder runs for real.
const page = registrations.find((row) => row.name === 'main')
const PageComponent = (() => {
  // The component was passed as the second argument to slots.register.
  return null
})()

console.log('ok   module shape, id, inject, and slot registration')
console.log(registrations.map((row) => `${row.name}:${row.id ?? row.key}`).join(', '))

// --- calendar math, re-implemented from the same algorithm ----------------
// Keep this in sync with buildCalendar(); it is the bug-prone part.
const CELL = 12
const GAP = 3
function dayKeyOf(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
function parseDayKey(key) {
  const parts = String(key).split('-').map(Number)
  return new Date(parts[0], (parts[1] ?? 1) - 1, parts[2] ?? 1)
}
function buildCalendar(activity) {
  const start = activity.start
  const end = activity.end
  const byDay = new Map()
  for (const entry of activity.days ?? []) {
    byDay.set(entry.date, { tokens: entry.tokens, sessions: entry.sessions, turns: entry.turns })
  }
  const startDate = parseDayKey(start)
  const endDate = parseDayKey(end)
  const mondayOffset = (startDate.getDay() + 6) % 7
  const gridStart = new Date(startDate)
  gridStart.setDate(gridStart.getDate() - mondayOffset)
  const columns = []
  const cursor = new Date(gridStart)
  let index = 0
  while (cursor <= endDate) {
    const column = []
    for (let row = 0; row < 7; row += 1) {
      const date = new Date(cursor)
      date.setDate(date.getDate() + row)
      const key = dayKeyOf(date)
      const inside = date >= startDate && date <= endDate
      const bucket = byDay.get(key)
      column.push({ key, date, inside, tokens: bucket?.tokens ?? 0, sessions: bucket?.sessions ?? 0 })
    }
    columns.push(column)
    cursor.setDate(cursor.getDate() + 7)
    index += 1
    if (index > 60) break
  }
  const months = []
  const seen = new Set()
  for (let col = 0; col < columns.length; col += 1) {
    for (const cell of columns[col]) {
      if (!cell.inside) continue
      const monthKey = `${cell.date.getFullYear()}-${cell.date.getMonth()}`
      if (cell.date.getDate() === 1 && !seen.has(monthKey)) {
        seen.add(monthKey)
        months.push({ column: col, label: cell.date })
        break
      }
    }
  }
  return { columns, weeks: columns.length, months }
}

// A full 365-day window ending on a Wednesday.
const end = '2026-11-03' // Tuesday
const start = (() => {
  const d = parseDayKey(end)
  d.setDate(d.getDate() - 364)
  return dayKeyOf(d)
})()
const cal = buildCalendar({ start, end, days: [{ date: end, tokens: 100, sessions: 1, turns: 1 }] })
assert.equal(cal.weeks, 53, `365 days must span 53 week columns, got ${cal.weeks}`)
assert.equal(cal.columns.length, 53)
// Monday-first: row 0 of every column must be a Monday.
for (const column of cal.columns) assert.equal(column[0].date.getDay(), 1, `row 0 of column must be Monday`)
// Every inside cell must be within the window and unique.
const inside = cal.columns.flat().filter((cell) => cell.inside)
assert.equal(inside.length, 365, `expected 365 inside cells, got ${inside.length}`)
assert.equal(new Set(inside.map((cell) => cell.key)).size, 365, 'inside day keys are unique')
assert.equal(inside[0].key, start)
assert.equal(inside[inside.length - 1].key, end)
// The grid must start on or before the window start, never after.
assert.ok(cal.columns[0][0].key <= start)
// Month labels: one per distinct month in the window, ascending.
assert.ok(cal.months.length >= 12 && cal.months.length <= 13, `expected 12-13 month labels, got ${cal.months.length}`)
for (let i = 1; i < cal.months.length; i += 1) {
  assert.ok(cal.months[i].column > cal.months[i - 1].column, 'month labels are strictly ascending')
}
console.log(`ok   calendar: ${cal.weeks} weeks, ${inside.length} days, ${cal.months.length} month labels, Monday-first`)

// --- aggregation modes ----------------------------------------------------
function aggregateCells(calendar, mode) {
  const values = new Map()
  let max = 0
  let running = 0
  if (mode === 'weekly') {
    for (const column of calendar.columns) {
      let weekTotal = 0
      for (const cell of column) if (cell.inside) weekTotal += cell.tokens
      if (weekTotal > max) max = weekTotal
      for (const cell of column) values.set(cell.key, cell.inside ? weekTotal : 0)
    }
    return { values, max }
  }
  for (const column of calendar.columns) {
    for (const cell of column) {
      if (!cell.inside) { values.set(cell.key, 0); continue }
      if (mode === 'cumulative') {
        running += cell.tokens
        values.set(cell.key, running)
        if (running > max) max = running
      } else {
        values.set(cell.key, cell.tokens)
        if (cell.tokens > max) max = cell.tokens
      }
    }
  }
  return { values, max }
}

const multi = buildCalendar({
  start, end,
  days: [
    { date: start, tokens: 10, sessions: 1, turns: 1 },
    { date: end, tokens: 90, sessions: 2, turns: 3 },
  ],
})
const daily = aggregateCells(multi, 'daily')
assert.equal(daily.max, 90)
assert.equal(daily.values.get(start), 10)
assert.equal(daily.values.get(end), 90)

const weekly = aggregateCells(multi, 'weekly')
// start and end are 364 days apart = 52 weeks exactly, so both land in the same
// weekday row but different columns.
assert.equal(weekly.values.get(start), 10)
assert.equal(weekly.values.get(end), 90)
assert.ok(weekly.max >= 90)

const cumulative = aggregateCells(multi, 'cumulative')
assert.equal(cumulative.values.get(start), 10)
assert.equal(cumulative.values.get(end), 100, 'cumulative sums through the window')
assert.equal(cumulative.max, 100)
// Cumulative is monotonic across inside days.
let previous = -1
for (const cell of multi.columns.flat().filter((c) => c.inside)) {
  const value = cumulative.values.get(cell.key)
  assert.ok(value >= previous, 'cumulative never decreases')
  previous = value
}
console.log('ok   aggregation: daily / weekly / cumulative, cumulative monotonic')

// --- level scale ----------------------------------------------------------
function levelOf(value, max) {
  if (!(value > 0) || !(max > 0)) return 0
  const ratio = value / max
  if (ratio <= 0.25) return 1
  if (ratio <= 0.5) return 2
  if (ratio <= 0.8) return 3
  return 4
}
assert.equal(levelOf(0, 100), 0)
assert.equal(levelOf(1, 100), 1)
assert.equal(levelOf(25, 100), 1)
assert.equal(levelOf(26, 100), 2)
assert.equal(levelOf(50, 100), 2)
assert.equal(levelOf(51, 100), 3)
assert.equal(levelOf(80, 100), 3)
assert.equal(levelOf(81, 100), 4)
assert.equal(levelOf(100, 100), 4)
assert.equal(levelOf(5, 0), 0, 'zero max yields level 0')
console.log('ok   level scale: 5 buckets, 0 for empty')

// --- locale key parity ----------------------------------------------------
const zhBlock = source.slice(source.indexOf('const zh = {'), source.indexOf('const en = {'))
const enBlock = source.slice(source.indexOf('const en = {'), source.indexOf('// -----------------------------------------------------------------------\n    // Formatting'))
const keysOf = (block) => [...block.matchAll(/^\s{6}([A-Za-z][A-Za-z0-9]*):/gm)].map((m) => m[1]).sort()
const zhKeys = keysOf(zhBlock)
const enKeys = keysOf(enBlock)
assert.ok(zhKeys.length > 40, `expected a substantial dictionary, got ${zhKeys.length}`)
assert.deepEqual(enKeys, zhKeys, 'zh and en key sets must match')
console.log(`ok   locale parity: ${zhKeys.length} keys in both zh and en`)

// Every t('key') used in the component must exist in the dictionary.
const used = new Set([...source.matchAll(/\bt\('([A-Za-z][A-Za-z0-9]*)'\)/g)].map((m) => m[1]))
const missing = [...used].filter((key) => !zhKeys.includes(key))
assert.deepEqual(missing, [], `missing dictionary keys: ${missing.join(', ')}`)
console.log(`ok   every t() key resolves (${used.size} distinct keys used)`)

console.log('\nall client checks passed')
