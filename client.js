window.__ModuleLoader__.load({
  id: '@local/dsh-profile-insights',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo, useRef, useCallback } = React

    const NS = 'profileInsights'
    const API = '/api/dsh-profile-insights'
    const REQUEST_TIMEOUT_MS = 30_000

    // -----------------------------------------------------------------------
    // Copy
    // -----------------------------------------------------------------------

    const zh = {
      panel: '个人资料',
      title: '个人资料与洞察',
      intro: '你的使用概览、全年 Token 活动与日常使用洞察。',
      refresh: '刷新',
      refreshing: '刷新中…',
      avatarUpload: '上传头像',
      avatarSaving: '保存中…',
      avatarReset: '恢复默认',
      avatarHint: 'PNG、JPG、WebP · 最大 10 MB · 居中裁剪',
      avatarSaved: '头像已保存',
      avatarRestored: '已恢复默认头像',
      avatarTypeError: '请选择 PNG、JPG 或 WebP 图片。',
      avatarSizeError: '图片不能超过 10 MB。',
      avatarImageError: '无法读取这张图片，请换一张重试。',
      avatarSaveError: '头像保存失败，请重试。',
      loading: '正在统计…',
      errorTitle: '暂时无法读取使用数据',
      errorBody: 'Host 端统计服务没有响应。确认插件已启用后重试。',
      refreshError: '刷新失败，当前显示上次成功读取的数据。请稍后重试。',
      retry: '重试',
      emptyTitle: '还没有使用记录',
      emptyBody: '开始一次对话后，这里会出现你的统计。',

      metricTokens: '累计使用的 Token',
      metricTokensCaption: '输入 {input} · 输出 {output}',
      metricPeak: 'Token 使用峰值',
      metricPeakCaption: '峰值出现在 {date}',
      metricPeakEmpty: '暂无峰值',
      metricLongest: '最长任务用时',
      metricLongestCaption: '{title}',
      metricLongestEmpty: '暂无记录',
      metricLongestStreak: '最长连续天数',
      metricLongestStreakCaption: '截至 {date}',
      metricLongestStreakEmpty: '暂无记录',
      metricCurrentStreak: '当前连续天数',
      metricCurrentStreakCaption: '保持每天使用即可延续',
      unitDay: '天',
      unitSession: '个会话',

      activityTitle: 'Token 活动',
      activityIntro: '过去一年每天的 Token 用量，颜色越深用量越大。',
      viewDaily: '每天',
      viewWeekly: '每周',
      viewCumulative: '累计',
      legendLess: '少',
      legendMore: '多',
      activityTotal: '这一年共 {tokens} Token',
      activityEmpty: '这一年还没有活动记录。',
      cellTooltip: '{date} · {tokens} Token · {sessions} 个会话',
      cellTooltipEmpty: '{date} · 无活动',
      weekTooltip: '{start} 起这一周 · {tokens} Token',
      cumulativeTooltip: '截至 {date} · 累计 {tokens} Token',

      insightsTitle: '洞察',
      insightsIntro: '你最常用的推理强度、探索过的技能与工具偏好。',
      effortTitle: '最常用的推理强度',
      effortEmpty: '还没有推理强度记录。',
      effortDefault: '默认',
      effortRequests: '{count} 次请求',
      skillsTitle: '已探索的技能',
      skillsCaption: '已使用 {used} / 共 {total}',
      skillsEmpty: '还没有通过技能工具调用过技能。',
      modelsTitle: '常用模型',
      modelsEmpty: '还没有模型记录。',
      toolsTitle: '常用工具',
      toolsEmpty: '还没有工具调用记录。',
      requestsUnit: '次',
      callsUnit: '次',
      totalsLine: '{sessions} 个会话 · {turns} 轮对话 · {steps} 个步骤',
    }

    const en = {
      panel: 'Profile',
      title: 'Profile & Insights',
      intro: 'Your usage overview, a year of token activity, and everyday insights.',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      avatarUpload: 'Upload avatar',
      avatarSaving: 'Saving…',
      avatarReset: 'Restore default',
      avatarHint: 'PNG, JPG, WebP · Up to 10 MB · Center crop',
      avatarSaved: 'Avatar saved',
      avatarRestored: 'Default avatar restored',
      avatarTypeError: 'Choose a PNG, JPG, or WebP image.',
      avatarSizeError: 'The image must be no larger than 10 MB.',
      avatarImageError: 'This image could not be read. Try another image.',
      avatarSaveError: 'The avatar could not be saved. Please retry.',
      loading: 'Crunching numbers…',
      errorTitle: 'Usage data is unavailable',
      errorBody: 'The Host statistics service did not answer. Check that the plugin is enabled, then retry.',
      refreshError: 'Refresh failed. Showing the last successful data. Please try again.',
      retry: 'Retry',
      emptyTitle: 'No usage yet',
      emptyBody: 'Start a conversation and your statistics will appear here.',

      metricTokens: 'Total tokens used',
      metricTokensCaption: 'Input {input} · output {output}',
      metricPeak: 'Peak token usage',
      metricPeakCaption: 'Busiest on {date}',
      metricPeakEmpty: 'No peak yet',
      metricLongest: 'Longest task',
      metricLongestCaption: '{title}',
      metricLongestEmpty: 'No record yet',
      metricLongestStreak: 'Longest streak',
      metricLongestStreakCaption: 'Ended {date}',
      metricLongestStreakEmpty: 'No record yet',
      metricCurrentStreak: 'Current streak',
      metricCurrentStreakCaption: 'Keep using it daily to continue',
      unitDay: 'days',
      unitSession: 'sessions',

      activityTitle: 'Token activity',
      activityIntro: 'Daily token usage over the past year; darker means more.',
      viewDaily: 'Daily',
      viewWeekly: 'Weekly',
      viewCumulative: 'Cumulative',
      legendLess: 'Less',
      legendMore: 'More',
      activityTotal: '{tokens} tokens this year',
      activityEmpty: 'No activity in the past year.',
      cellTooltip: '{date} · {tokens} tokens · {sessions} sessions',
      cellTooltipEmpty: '{date} · no activity',
      weekTooltip: 'Week of {start} · {tokens} tokens',
      cumulativeTooltip: 'Through {date} · {tokens} tokens cumulative',

      insightsTitle: 'Insights',
      insightsIntro: 'Your most-used reasoning effort, explored skills, and tool preferences.',
      effortTitle: 'Most-used reasoning effort',
      effortEmpty: 'No reasoning-effort records yet.',
      effortDefault: 'Default',
      effortRequests: '{count} requests',
      skillsTitle: 'Skills explored',
      skillsCaption: '{used} of {total} used',
      skillsEmpty: 'No skill has been invoked through the skill tool yet.',
      modelsTitle: 'Models',
      modelsEmpty: 'No model records yet.',
      toolsTitle: 'Tools',
      toolsEmpty: 'No tool calls yet.',
      requestsUnit: '',
      callsUnit: '',
      totalsLine: '{sessions} sessions · {turns} turns · {steps} steps',
    }

    // -----------------------------------------------------------------------
    // Formatting
    // -----------------------------------------------------------------------

    /** Compact token count: 1.2M, 34.5K, 987. */
    function formatTokens(value) {
      const n = Number(value)
      if (!Number.isFinite(n) || n <= 0) return '0'
      if (n >= 1e9) return `${trim(n / 1e9)}B`
      if (n >= 1e6) return `${trim(n / 1e6)}M`
      if (n >= 1e3) return `${trim(n / 1e3)}K`
      return String(Math.round(n))
    }

    /** One decimal, dropping a trailing .0. */
    function trim(value) {
      const rounded = Math.round(value * 10) / 10
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
    }

    /** Duration as hours/minutes, never "0". */
    function formatDuration(ms, t) {
      const total = Number(ms)
      if (!Number.isFinite(total) || total <= 0) return '—'
      const seconds = Math.max(1, Math.round(total / 1000))
      const hours = Math.floor(seconds / 3600)
      const minutes = Math.floor((seconds % 3600) / 60)
      const secs = seconds % 60
      if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
      if (minutes > 0) return `${minutes}m ${secs}s`
      return `${secs}s`
    }

    /** Local YYYY-MM-DD key for a Date. */
    function dayKeyOf(date) {
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    /** Parse an actual YYYY-MM-DD calendar day without normalizing invalid dates. */
    function parseDayKey(key) {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key))
      if (match === null) return new Date(NaN)
      const date = new Date(0)
      date.setFullYear(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
      date.setHours(0, 0, 0, 0)
      return dayKeyOf(date) === key ? date : new Date(NaN)
    }

    /** Short localized date such as 11月3日 / Nov 3. */
    function formatDay(key, locale) {
      const date = parseDayKey(key)
      if (Number.isNaN(date.getTime())) return String(key ?? '')
      try {
        return date.toLocaleDateString(locale, { month: 'short', day: 'numeric' })
      } catch {
        return String(key)
      }
    }

    /** Month label such as 11月 / Nov. */
    function formatMonth(date, locale) {
      try {
        return date.toLocaleDateString(locale, { month: 'short' })
      } catch {
        return String(date.getMonth() + 1)
      }
    }

    /** Substitute {name} placeholders. */
    function fill(template, values) {
      return String(template).replace(/\{(\w+)\}/g, (match, key) => (
        values[key] === undefined || values[key] === null ? match : String(values[key])
      ))
    }

    // -----------------------------------------------------------------------
    // Heatmap model
    // -----------------------------------------------------------------------

    const CELL = 12
    const GAP = 3

    /**
     * Expand the sparse activity list into a full Monday-first calendar grid.
     *
     * The grid starts on the Monday on or before `start` and ends on `end`, so
     * the first column may contain leading days from the previous week. Those
     * leading cells render as inert placeholders.
     */
    function buildCalendar(activity) {
      const start = activity && typeof activity.start === 'string' ? activity.start : dayKeyOf(new Date())
      const end = activity && typeof activity.end === 'string' ? activity.end : dayKeyOf(new Date())
      const byDay = new Map()
      const days = Array.isArray(activity?.days) ? activity.days : []
      for (const entry of days) {
        if (entry === null || typeof entry !== 'object') continue
        if (typeof entry.date !== 'string') continue
        byDay.set(entry.date, {
          tokens: Number(entry.tokens) || 0,
          sessions: Number(entry.sessions) || 0,
          turns: Number(entry.turns) || 0,
        })
      }

      const startDate = parseDayKey(start)
      const endDate = parseDayKey(end)
      if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
        return { columns: [], weeks: 0, months: [], max: 0, total: 0 }
      }

      // Monday-first: getDay() is 0 for Sunday, so Sunday maps to 6.
      const mondayOffset = (startDate.getDay() + 6) % 7
      const gridStart = new Date(startDate)
      gridStart.setDate(gridStart.getDate() - mondayOffset)

      const columns = []
      const cursor = new Date(gridStart)
      // The Host supports up to 730 days: including a partial first/last week
      // needs at most 106 columns. Keep that full window and remain bounded.
      while (cursor <= endDate && columns.length < 106) {
        const column = []
        for (let row = 0; row < 7; row += 1) {
          const date = new Date(cursor)
          date.setDate(date.getDate() + row)
          const key = dayKeyOf(date)
          const inside = date >= startDate && date <= endDate
          const bucket = byDay.get(key)
          column.push({
            key,
            date,
            inside,
            tokens: bucket?.tokens ?? 0,
            sessions: bucket?.sessions ?? 0,
            turns: bucket?.turns ?? 0,
          })
        }
        columns.push(column)
        cursor.setDate(cursor.getDate() + 7)
      }

      // Month labels sit above the first column that contains that month's 1st.
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

      let total = 0
      for (const column of columns) {
        for (const cell of column) if (cell.inside) total += cell.tokens
      }

      return { columns, weeks: columns.length, months, total }
    }

    /**
     * Compute per-cell display values for the active aggregation.
     *
     * - daily: the day's own tokens
     * - weekly: the whole week column's tokens, repeated on each of its cells so
     *   a column reads as one value
     * - cumulative: the running total through that day
     */
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
          if (!cell.inside) {
            values.set(cell.key, 0)
            continue
          }
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

    /** Map one value onto the five-level scale (0 = no activity). */
    function levelOf(value, max) {
      if (!(value > 0) || !(max > 0)) return 0
      const ratio = value / max
      if (ratio <= 0.25) return 1
      if (ratio <= 0.5) return 2
      if (ratio <= 0.8) return 3
      return 4
    }

    // -----------------------------------------------------------------------
    // Icons
    // -----------------------------------------------------------------------

    function Icon({ size = 20, active }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: active ? 1.9 : 1.7,
        strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true,
      },
        h('circle', { cx: 12, cy: 8.5, r: 3.6 }),
        h('path', { d: 'M4.8 20c.7-3.6 3.6-5.6 7.2-5.6s6.5 2 7.2 5.6' }),
      )
    }

    function RefreshIcon({ size = 16 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
        stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round',
        'aria-hidden': true,
      },
        h('path', { d: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3' }),
        h('path', { d: 'M19.8 4.6v4.2h-4.2' }),
      )
    }

    // -----------------------------------------------------------------------
    // Styles
    // -----------------------------------------------------------------------

    const CSS = `
      .pi-page { box-sizing: border-box; height: 100%; color: var(--dsw-alias-label-primary);
        display: flex; flex-direction: column; align-items: center; gap: 32px;
        padding: 0 clamp(24px, 4vw, 48px) 48px; overflow: auto; scrollbar-gutter: stable both-edges; }
      .pi-page > * { box-sizing: border-box; width: 100%; max-width: 960px; min-width: 0; flex-shrink: 0; }
      .pi-refreshError { margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
      .pi-head { display: flex; justify-content: space-between; align-items: center;
        flex-wrap: wrap; gap: 16px; padding-top: 28px; }
      .pi-title { margin: 0; font-size: 20px; font-weight: 500; line-height: 28px; }
      .pi-intro { margin: 4px 0 0; color: var(--dsw-alias-label-secondary);
        font-size: 13px; line-height: 20px; }
      @media (min-width: 800px) {
        [data-platform='darwin'] .pi-head { padding-top: calc(28px + var(--dsh-frame-top-clearance, 0px)); }
      }

      .pi-btn { box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 32px;
        padding: 0 12px; border-radius: var(--dsw-radius-sm);
        border: 1px solid var(--dsw-alias-border-l3);
        background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
        font-size: 13px; line-height: 20px; font-family: inherit; cursor: pointer; }
      .pi-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
      .pi-btn:active:not(:disabled) { background: var(--dsw-alias-interactive-bg-active); }
      .pi-btn:disabled { color: var(--dsw-alias-label-caption); cursor: default; }
      .pi-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
      .pi-refresh { min-width: 92px; flex: none; align-self: center; }
      .pi-btnIcon { display: inline-flex; align-items: center; justify-content: center;
        width: 16px; height: 16px; flex: 0 0 16px; line-height: 0; }
      .pi-btnIcon svg { display: block; }
      .pi-btnLabel { display: block; line-height: 20px; }
      .pi-spin { transform-origin: 50% 50%; animation: pi-rotate 900ms linear infinite; }
      @media (prefers-reduced-motion: reduce) { .pi-spin { animation: none; } }
      @keyframes pi-rotate { to { transform: rotate(360deg); } }

      .pi-card { background: var(--dsw-alias-bg-layer-2);
        border: 1px solid var(--dsw-alias-border-l3);
        border-radius: var(--dsw-radius-lg); padding: 20px 24px; }
      .pi-sectionHead { display: flex; align-items: baseline; justify-content: space-between;
        gap: 16px; flex-wrap: wrap; margin-bottom: 16px; }
      .pi-sectionTitle { margin: 0; font-size: 15px; font-weight: 500; line-height: 22px; }
      .pi-sectionIntro { margin: 2px 0 0; font-size: 12px; line-height: 18px;
        color: var(--dsw-alias-label-tertiary); }

      /* identity */
      .pi-identity { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; }
      .pi-avatarTrigger { display: block; box-sizing: border-box; width: 60px; height: 60px;
        flex: none; padding: 0; border: 0; border-radius: 50%; background: transparent; cursor: pointer; }
      .pi-avatarTrigger:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 3px; }
      .pi-avatarTrigger:disabled { cursor: default; }
      .pi-avatarTrigger > * { box-sizing: border-box; display: block; }
      .pi-avatarTrigger > .pi-monogram { display: flex; }
      .pi-identityText { min-width: 0; flex: 1; overflow-wrap: anywhere; }
      .pi-avatarTools { margin-left: auto; max-width: 100%; min-width: 0; }
      .pi-avatarActions { display: flex; gap: 8px; flex-wrap: wrap; }
      .pi-avatarHint, .pi-avatarStatus { margin: 6px 0 0; font-size: 11px; line-height: 16px;
        color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
      .pi-avatarStatus { color: var(--dsw-alias-label-primary); }
      @media (max-width: 600px) { .pi-avatarTools { width: 100%; margin-left: 0; } }
      .pi-avatar { width: 60px; height: 60px; border-radius: 50%; flex: none;
        object-fit: cover; background: var(--dsw-alias-bg-module-platform);
        border: 1px solid var(--dsw-alias-border-l3); }
      .pi-monogram { width: 60px; height: 60px; border-radius: 50%; flex: none;
        display: flex; align-items: center; justify-content: center;
        background: var(--dsw-alias-state-business-tertiary);
        color: var(--dsw-alias-state-business-primary);
        font-size: 24px; font-weight: 500; line-height: 1;
        border: 1px solid var(--dsw-alias-border-l3); }
      .pi-name { margin: 0; font-size: 18px; font-weight: 500; line-height: 26px; }
      .pi-sub { margin: 2px 0 0; font-size: 12px; line-height: 18px;
        color: var(--dsw-alias-label-tertiary); }

      /* metrics */
      .pi-metrics { display: grid; gap: 12px;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 158px), 1fr)); }
      .pi-metric { background: var(--dsw-alias-bg-layer-2);
        border: 1px solid var(--dsw-alias-border-l3);
        border-radius: var(--dsw-radius-lg); padding: 16px 18px;
        display: flex; flex-direction: column; gap: 6px; min-width: 0; }
      .pi-metricLabel { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
      .pi-metricValue { font-size: 26px; font-weight: 500; line-height: 32px;
        font-variant-numeric: tabular-nums; letter-spacing: -0.01em;
        display: flex; align-items: baseline; gap: 4px; }
      .pi-metricUnit { font-size: 13px; font-weight: 400; color: var(--dsw-alias-label-secondary); }
      .pi-metricCaption { font-size: 11px; line-height: 16px; color: var(--dsw-alias-label-caption);
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

      /* heatmap */
      .pi-hmScroll { overflow-x: auto; padding-bottom: 4px; }
      .pi-hm { display: inline-flex; flex-direction: column; gap: 6px; min-width: 0; }
      .pi-hmMonths { display: grid; gap: ${GAP}px; margin-left: 30px; height: 14px; }
      .pi-hmMonth { font-size: 10px; line-height: 14px; color: var(--dsw-alias-label-tertiary);
        white-space: nowrap; }
      .pi-hmBody { display: flex; gap: 6px; }
      .pi-hmWeekdays { display: grid; grid-template-rows: repeat(7, ${CELL}px); gap: ${GAP}px;
        width: 24px; flex: none; }
      .pi-hmWeekday { font-size: 10px; line-height: ${CELL}px; text-align: right;
        color: var(--dsw-alias-label-caption); }
      .pi-hmGrid { display: grid; grid-auto-flow: column;
        grid-template-rows: repeat(7, ${CELL}px); gap: ${GAP}px; }
      .pi-cell { width: ${CELL}px; height: ${CELL}px; border-radius: 3px;
        background: var(--dsw-alias-bg-module-platform); border: none; padding: 0;
        display: block; }
      .pi-cell[data-inert='true'] { background: transparent; }
      .pi-cell[data-level='1'] { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 22%, var(--dsw-alias-bg-module-platform)); }
      .pi-cell[data-level='2'] { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 45%, var(--dsw-alias-bg-module-platform)); }
      .pi-cell[data-level='3'] { background: color-mix(in srgb, var(--dsw-alias-state-business-primary) 70%, var(--dsw-alias-bg-module-platform)); }
      .pi-cell[data-level='4'] { background: var(--dsw-alias-state-business-primary); }
      .pi-cell[data-interactive='true'] { cursor: default; }
      .pi-cell[data-interactive='true']:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
      .pi-hmFoot { display: flex; align-items: center; justify-content: space-between;
        gap: 16px; flex-wrap: wrap; margin-top: 14px; }
      .pi-legend { display: flex; align-items: center; gap: 4px; font-size: 11px;
        color: var(--dsw-alias-label-caption); }
      .pi-legend .pi-cell { width: 10px; height: 10px; }
      .pi-hmTotal { font-size: 12px; color: var(--dsw-alias-label-tertiary);
        font-variant-numeric: tabular-nums; }

      .pi-tip { position: fixed; z-index: 40; pointer-events: none;
        background: var(--dsw-alias-bg-overlay); color: var(--dsw-alias-label-primary);
        border: 1px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-sm);
        padding: 5px 9px; font-size: 11px; line-height: 16px; white-space: nowrap;
        box-shadow: var(--dsw-shadow-lv2, 0 4px 12px rgba(0,0,0,.12)); }

      /* segmented */
      .pi-seg { display: inline-flex; padding: 2px; gap: 2px;
        background: var(--dsw-alias-bg-module-platform);
        border-radius: var(--dsw-radius-sm); }
      .pi-segBtn { height: 26px; padding: 0 12px; border: none; background: transparent;
        border-radius: 6px; font-family: inherit; font-size: 12px; line-height: 18px;
        color: var(--dsw-alias-label-secondary); cursor: pointer; }
      .pi-segBtn:hover { color: var(--dsw-alias-label-primary); }
      .pi-segBtn[aria-pressed='true'] { background: var(--dsw-alias-bg-layer-2);
        color: var(--dsw-alias-label-primary); font-weight: 500;
        box-shadow: var(--dsw-shadow-lv1, 0 1px 2px rgba(0,0,0,.08)); }
      .pi-segBtn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -1px; }

      /* insights */
      .pi-insights { display: grid; gap: 12px;
        grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); }
      .pi-panel { background: var(--dsw-alias-bg-layer-2);
        border: 1px solid var(--dsw-alias-border-l3);
        border-radius: var(--dsw-radius-lg); padding: 18px 20px;
        display: flex; flex-direction: column; gap: 12px; min-width: 0; }
      .pi-panelTitle { margin: 0; font-size: 13px; font-weight: 500; line-height: 20px; }
      .pi-rows { display: flex; flex-direction: column; gap: 10px; }
      .pi-rankRow { display: flex; flex-direction: column; gap: 5px; }
      .pi-rankTop { display: flex; align-items: baseline; justify-content: space-between;
        gap: 12px; font-size: 12px; line-height: 18px; }
      .pi-rankName { color: var(--dsw-alias-label-primary); overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; }
      .pi-rankValue { color: var(--dsw-alias-label-tertiary); flex: none;
        font-variant-numeric: tabular-nums; }
      .pi-bar { height: 5px; border-radius: 999px; overflow: hidden;
        background: var(--dsw-alias-bg-module-platform); }
      .pi-barFill { height: 100%; border-radius: 999px;
        background: var(--dsw-alias-state-business-primary); }
      .pi-barFill[data-muted='true'] { background: var(--dsw-alias-state-business-tertiary); }
      .pi-empty { margin: 0; font-size: 12px; line-height: 18px;
        color: var(--dsw-alias-label-tertiary); }
      .pi-skillHead { display: flex; align-items: baseline; gap: 8px; }
      .pi-skillCount { font-size: 22px; font-weight: 500; line-height: 28px;
        font-variant-numeric: tabular-nums; }
      .pi-skillOf { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
      .pi-skillBar { height: 6px; border-radius: 999px; overflow: hidden;
        background: var(--dsw-alias-bg-module-platform); }
      .pi-skillFill { height: 100%; border-radius: 999px;
        background: var(--dsw-alias-state-business-primary); transition: width 240ms ease; }
      .pi-tags { display: flex; flex-wrap: wrap; gap: 6px; }
      .pi-tag { font-size: 11px; line-height: 16px; padding: 2px 8px;
        border-radius: 999px; background: var(--dsw-alias-bg-module-platform);
        color: var(--dsw-alias-label-secondary); }

      /* states */
      .pi-state { display: flex; flex-direction: column; align-items: center;
        justify-content: center; gap: 8px; text-align: center;
        padding: 64px 24px; color: var(--dsw-alias-label-tertiary); }
      .pi-stateTitle { margin: 0; font-size: 14px; font-weight: 500;
        color: var(--dsw-alias-label-primary); }
      .pi-stateBody { margin: 0; font-size: 12px; line-height: 18px; max-width: 420px; }
      .pi-skeleton { height: 12px; border-radius: 6px;
        background: var(--dsw-alias-bg-skeleton); }
      @keyframes pi-pulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }
      .pi-skeleton { animation: pi-pulse 1.4s ease-in-out infinite; }
      @media (prefers-reduced-motion: reduce) {
        .pi-skeleton, .pi-spin, .pi-skillFill { animation: none; transition: none; }
      }
    `

    // -----------------------------------------------------------------------
    // Small building blocks
    // -----------------------------------------------------------------------

    function SectionHead({ title, intro, children }) {
      return h('div', { className: 'pi-sectionHead' },
        h('div', null,
          h('h2', { className: 'pi-sectionTitle' }, title),
          intro ? h('p', { className: 'pi-sectionIntro' }, intro) : null,
        ),
        children ?? null,
      )
    }

    function Metric({ label, value, unit, caption }) {
      return h('div', { className: 'pi-metric' },
        h('div', { className: 'pi-metricLabel' }, label),
        h('div', { className: 'pi-metricValue' },
          h('span', null, value),
          unit ? h('span', { className: 'pi-metricUnit' }, unit) : null,
        ),
        h('div', { className: 'pi-metricCaption', title: caption }, caption),
      )
    }

    function RankRow({ name, value, ratio, muted }) {
      const width = Math.max(2, Math.round(Math.min(1, Number(ratio) || 0) * 100))
      return h('div', { className: 'pi-rankRow' },
        h('div', { className: 'pi-rankTop' },
          h('span', { className: 'pi-rankName', title: name }, name),
          h('span', { className: 'pi-rankValue' }, value),
        ),
        h('div', { className: 'pi-bar' },
          h('div', { className: 'pi-barFill', 'data-muted': muted ? 'true' : undefined, style: { width: `${width}%` } }),
        ),
      )
    }

    // -----------------------------------------------------------------------
    // Heatmap
    // -----------------------------------------------------------------------

    function Heatmap({ activity, mode, onMode, t, locale }) {
      const calendar = useMemo(() => buildCalendar(activity), [activity])
      const { values, max } = useMemo(() => aggregateCells(calendar, mode), [calendar, mode])
      const [tip, setTip] = useState(null)

      const showTip = useCallback((event, text) => {
        const rect = event.currentTarget.getBoundingClientRect()
        setTip({ x: rect.left + rect.width / 2, y: rect.top - 8, text })
      }, [])
      const hideTip = useCallback(() => setTip(null), [])

      useEffect(() => () => setTip(null), [])

      const columns = calendar.columns
      const weeks = Math.max(calendar.weeks, 1)
      const gridStyle = {
        gridTemplateColumns: `repeat(${weeks}, ${CELL}px)`,
      }

      const cells = []
      for (let col = 0; col < columns.length; col += 1) {
        for (const cell of columns[col]) {
          if (!cell.inside) {
            cells.push(h('div', { key: `x-${cell.key}`, className: 'pi-cell', 'data-inert': 'true' }))
            continue
          }
          const value = values.get(cell.key) ?? 0
          const level = levelOf(value, max)
          let text
          if (mode === 'weekly') {
            text = value > 0
              ? fill(t('weekTooltip'), { start: formatDay(columns[col][0].key, locale), tokens: formatTokens(value) })
              : fill(t('cellTooltipEmpty'), { date: formatDay(cell.key, locale) })
          } else if (mode === 'cumulative') {
            text = value > 0
              ? fill(t('cumulativeTooltip'), { date: formatDay(cell.key, locale), tokens: formatTokens(value) })
              : fill(t('cellTooltipEmpty'), { date: formatDay(cell.key, locale) })
          } else {
            text = value > 0
              ? fill(t('cellTooltip'), {
                date: formatDay(cell.key, locale),
                tokens: formatTokens(value),
                sessions: cell.sessions,
              })
              : fill(t('cellTooltipEmpty'), { date: formatDay(cell.key, locale) })
          }
          cells.push(h('div', {
            key: cell.key,
            className: 'pi-cell',
            'data-level': String(level),
            'data-interactive': 'true',
            tabIndex: 0,
            role: 'img',
            'aria-label': text,
            onMouseEnter: (event) => showTip(event, text),
            onMouseLeave: hideTip,
            onFocus: (event) => showTip(event, text),
            onBlur: hideTip,
          }))
        }
      }

      const weekdayLabels = useMemo(() => {
        // 2024-01-01 is a Monday, so index 0 is Monday and 6 is Sunday.
        const base = new Date(2024, 0, 1)
        const labels = []
        for (let row = 0; row < 7; row += 1) {
          const date = new Date(base)
          date.setDate(date.getDate() + row)
          try {
            labels.push(date.toLocaleDateString(locale, { weekday: 'narrow' }))
          } catch {
            labels.push('')
          }
        }
        return labels
      }, [locale])
      const weekdayIndexes = [0, 2, 4]

      return h('section', { className: 'pi-card' },
        h(SectionHead, { title: t('activityTitle'), intro: t('activityIntro') },
          h('div', { className: 'pi-seg', role: 'group', 'aria-label': t('activityTitle') },
            [['daily', t('viewDaily')], ['weekly', t('viewWeekly')], ['cumulative', t('viewCumulative')]]
              .map(([id, label]) => h('button', {
                key: id,
                type: 'button',
                className: 'pi-segBtn',
                'aria-pressed': mode === id ? 'true' : 'false',
                onClick: () => onMode(id),
              }, label)),
          ),
        ),
        h('div', { className: 'pi-hmScroll' },
          h('div', { className: 'pi-hm' },
            h('div', { className: 'pi-hmMonths', style: gridStyle },
              calendar.months.map((month) => h('span', {
                key: `${month.column}-${month.label.getMonth()}`,
                className: 'pi-hmMonth',
                style: { gridColumn: String(month.column + 1) },
              }, formatMonth(month.label, locale))),
            ),
            h('div', { className: 'pi-hmBody' },
              h('div', { className: 'pi-hmWeekdays', 'aria-hidden': 'true' },
                Array.from({ length: 7 }, (unused, row) => h('span', {
                  key: row,
                  className: 'pi-hmWeekday',
                }, weekdayIndexes.includes(row) ? weekdayLabels[row] : '')),
              ),
              h('div', { className: 'pi-hmGrid', style: gridStyle, role: 'group' }, cells),
            ),
          ),
        ),
        h('div', { className: 'pi-hmFoot' },
          h('span', { className: 'pi-hmTotal' }, calendar.total > 0
            ? fill(t('activityTotal'), { tokens: formatTokens(calendar.total) })
            : t('activityEmpty')),
          h('div', { className: 'pi-legend', 'aria-hidden': 'true' },
            h('span', null, t('legendLess')),
            [0, 1, 2, 3, 4].map((level) => h('span', {
              key: level,
              className: 'pi-cell',
              'data-level': String(level),
            })),
            h('span', null, t('legendMore')),
          ),
        ),
        tip === null ? null : h('div', {
          className: 'pi-tip',
          style: { left: `${tip.x}px`, top: `${tip.y}px`, transform: 'translate(-50%, -100%)' },
        }, tip.text),
      )
    }

    // -----------------------------------------------------------------------
    // Insights
    // -----------------------------------------------------------------------

    function Insights({ insights, t }) {
      const effort = Array.isArray(insights?.reasoningEffort) ? insights.reasoningEffort : []
      const models = Array.isArray(insights?.models) ? insights.models : []
      const tools = Array.isArray(insights?.tools) ? insights.tools : []
      const skills = insights?.skills ?? {}
      const used = Number(skills.used) || 0
      const total = Number(skills.total) || 0
      const ratio = total > 0 ? Math.min(1, used / total) : 0
      const effortMax = effort.reduce((max, row) => Math.max(max, Number(row.requests) || 0), 0)
      const effortSum = effort.reduce((sum, row) => sum + (Number(row.requests) || 0), 0)
      const modelMax = models.reduce((max, row) => Math.max(max, Number(row.requests) || 0), 0)
      const toolMax = tools.reduce((max, row) => Math.max(max, Number(row.calls) || 0), 0)

      return h('section', null,
        h(SectionHead, { title: t('insightsTitle'), intro: t('insightsIntro') }),
        h('div', { className: 'pi-insights' },
          h('div', { className: 'pi-panel' },
            h('h3', { className: 'pi-panelTitle' }, t('effortTitle')),
            effort.length === 0
              ? h('p', { className: 'pi-empty' }, t('effortEmpty'))
              : h('div', { className: 'pi-rows' }, effort.slice(0, 5).map((row) => {
                const id = String(row.id ?? '')
                const label = id === 'default' ? t('effortDefault') : id
                const requests = Number(row.requests) || 0
                const percent = effortSum > 0 ? Math.round((requests / effortSum) * 100) : 0
                return h(RankRow, {
                  key: id,
                  name: label,
                  value: `${percent}% · ${fill(t('effortRequests'), { count: requests })}`,
                  ratio: effortMax > 0 ? requests / effortMax : 0,
                })
              })),
          ),
          h('div', { className: 'pi-panel' },
            h('h3', { className: 'pi-panelTitle' }, t('skillsTitle')),
            h('div', { className: 'pi-skillHead' },
              h('span', { className: 'pi-skillCount' }, String(used)),
              h('span', { className: 'pi-skillOf' }, fill(t('skillsCaption'), { used, total })),
            ),
            h('div', { className: 'pi-skillBar', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': Math.max(total, 1), 'aria-valuenow': used },
              h('div', { className: 'pi-skillFill', style: { width: `${Math.round(ratio * 100)}%` } }),
            ),
            Array.isArray(skills.names) && skills.names.length > 0
              ? h('div', { className: 'pi-tags' }, skills.names.slice(0, 8).map((name) => h('span', { key: name, className: 'pi-tag' }, name)))
              : h('p', { className: 'pi-empty' }, t('skillsEmpty')),
          ),
          h('div', { className: 'pi-panel' },
            h('h3', { className: 'pi-panelTitle' }, t('modelsTitle')),
            models.length === 0
              ? h('p', { className: 'pi-empty' }, t('modelsEmpty'))
              : h('div', { className: 'pi-rows' }, models.slice(0, 5).map((row) => {
                const requests = Number(row.requests) || 0
                const name = `${row.model ?? ''}`
                return h(RankRow, {
                  key: String(row.model ?? '').trim().toLowerCase(),
                  name,
                  value: `${requests}${t('requestsUnit')}`,
                  ratio: modelMax > 0 ? requests / modelMax : 0,
                  muted: true,
                })
              })),
          ),
          h('div', { className: 'pi-panel' },
            h('h3', { className: 'pi-panelTitle' }, t('toolsTitle')),
            tools.length === 0
              ? h('p', { className: 'pi-empty' }, t('toolsEmpty'))
              : h('div', { className: 'pi-rows' }, tools.slice(0, 6).map((row) => {
                const calls = Number(row.calls) || 0
                return h(RankRow, {
                  key: String(row.name),
                  name: String(row.name),
                  value: `${calls}${t('callsUnit')}`,
                  ratio: toolMax > 0 ? calls / toolMax : 0,
                  muted: true,
                })
              })),
          ),
        ),
      )
    }

    // -----------------------------------------------------------------------
    // Page
    // -----------------------------------------------------------------------

    /** Read the browser locale id so date formatting matches the UI language. */
    function useDateLocale() {
      const [locale, setLocale] = useState(() => (typeof navigator === 'undefined' ? 'zh-CN' : navigator.language))
      useEffect(() => {
        if (typeof document === 'undefined') return undefined
        const current = document.documentElement.lang
        if (typeof current === 'string' && current !== '') setLocale(current)
        if (typeof MutationObserver !== 'function') return undefined
        const observer = new MutationObserver(() => {
          const value = document.documentElement.lang
          if (typeof value === 'string' && value !== '') setLocale(value)
        })
        observer.observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] })
        return () => observer.disconnect()
      }, [])
      return locale
    }

    function avatarInputError(key) {
      return Object.assign(new Error(key), { avatarKey: key })
    }

    /** Decode locally and send only a small, square PNG to the Host. */
    async function prepareAvatar(file, signal) {
      if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw avatarInputError('avatarTypeError')
      if (file.size > 10 * 1024 * 1024) throw avatarInputError('avatarSizeError')
      if (signal.aborted) throw signal.reason
      let bitmap
      try {
        bitmap = await createImageBitmap(file)
        if (signal.aborted) throw signal.reason
        if (!(bitmap.width > 0 && bitmap.height > 0) || bitmap.width * bitmap.height > 64_000_000) throw avatarInputError('avatarImageError')
        const side = Math.min(bitmap.width, bitmap.height)
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = Math.min(512, side)
        const context = canvas.getContext('2d')
        if (!context) throw avatarInputError('avatarImageError')
        context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))
        if (signal.aborted) throw signal.reason
        if (!blob || blob.size > 2 * 1024 * 1024) throw avatarInputError('avatarImageError')
        return blob
      } catch (error) {
        if (signal.aborted || error?.avatarKey) throw error
        throw avatarInputError('avatarImageError')
      } finally {
        bitmap?.close()
      }
    }

    function Identity({ profile, name, monogram, subtitle, t, onAvatarChange }) {
      const [busy, setBusy] = useState(false)
      const [notice, setNotice] = useState(null)
      const [failed, setFailed] = useState(false)
      const input = useRef(null)
      const request = useRef(null)
      const alive = useRef(true)
      useEffect(() => {
        alive.current = true
        return () => { alive.current = false; request.current?.abort(); request.current = null }
      }, [])
      useEffect(() => { setFailed(false) }, [profile.avatarUrl])

      const save = async (file, reset = false) => {
        if (request.current || !alive.current) return
        const controller = new AbortController()
        request.current = controller
        setBusy(true)
        setNotice(null)
        let timer, onAbort
        try {
          const cancelled = new Promise((resolve, reject) => {
            onAbort = () => reject(controller.signal.reason ?? new Error('cancelled'))
            controller.signal.addEventListener('abort', onAbort, { once: true })
            timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
          })
          const pending = (async () => {
            const png = reset ? undefined : await prepareAvatar(file, controller.signal)
            if (controller.signal.aborted) throw controller.signal.reason
            const response = await fetch(`${API}/avatar`, {
              method: reset ? 'DELETE' : 'POST', credentials: 'same-origin', signal: controller.signal,
              headers: reset ? undefined : { 'content-type': 'image/png' }, body: png,
            })
            const body = await response.json()
            if (!response.ok || body?.ok !== true || typeof body.profile?.avatarUrl !== 'string' || typeof body.profile?.customAvatar !== 'boolean') throw new Error('avatar save failed')
            return body.profile
          })()
          const next = await Promise.race([pending, cancelled])
          if (!alive.current || request.current !== controller) return
          onAvatarChange(next)
          setFailed(false)
          setNotice({ error: false, key: reset ? 'avatarRestored' : 'avatarSaved' })
        } catch (error) {
          if (alive.current && request.current === controller) setNotice({ error: true, key: error?.avatarKey ?? 'avatarSaveError' })
        } finally {
          clearTimeout(timer)
          if (onAbort) controller.signal.removeEventListener('abort', onAbort)
          if (alive.current && request.current === controller) {
            request.current = null
            setBusy(false)
          }
        }
      }

      return h('div', { className: 'pi-card' },
        h('div', { className: 'pi-identity' },
          h('input', { ref: input, hidden: true, type: 'file', accept: 'image/png,image/jpeg,image/webp', 'aria-label': t('avatarUpload'),
            onChange: event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void save(file) } }),
          h('button', { type: 'button', className: 'pi-avatarTrigger', disabled: busy, 'aria-label': t('avatarUpload'), title: t('avatarUpload'), onClick: () => input.current?.click() },
            failed || typeof profile.avatarUrl !== 'string' || !profile.avatarUrl
              ? h('div', { className: 'pi-monogram', 'aria-hidden': true }, monogram)
              : h('img', { className: 'pi-avatar', src: profile.avatarUrl, alt: name, onError: () => setFailed(true) })),
          h('div', { className: 'pi-identityText' }, h('h2', { className: 'pi-name' }, name), h('p', { className: 'pi-sub' }, subtitle)),
          h('div', { className: 'pi-avatarTools' },
            h('div', { className: 'pi-avatarActions' },
              h('button', { type: 'button', className: 'pi-btn', disabled: busy, onClick: () => input.current?.click() }, busy ? t('avatarSaving') : t('avatarUpload')),
              profile.customAvatar ? h('button', { type: 'button', className: 'pi-btn', disabled: busy, onClick: () => { void save(undefined, true) } }, t('avatarReset')) : null),
            h('p', { className: 'pi-avatarHint' }, t('avatarHint')),
            notice ? h('p', { className: 'pi-avatarStatus', role: notice.error ? 'alert' : 'status' }, t(notice.key)) : null)),
      )
    }

    function Page({ t }) {
      const [state, setState] = useState({ status: 'loading', data: null, error: null })
      const [busy, setBusy] = useState(false)
      const [mode, setMode] = useState('daily')
      const avatarRevision = useRef(0)
      const alive = useRef(true)
      const activeRequest = useRef(null)
      const locale = useDateLocale()

      useEffect(() => {
        alive.current = true
        return () => {
          alive.current = false
          activeRequest.current?.controller.abort()
          activeRequest.current = null
        }
      }, [])

      const load = useCallback(async (force) => {
        if (!alive.current || (force && activeRequest.current !== null)) return
        activeRequest.current?.controller.abort()
        const controller = new AbortController()
        const request = { controller, avatarRevision: avatarRevision.current }
        activeRequest.current = request
        const isCurrent = () => alive.current && activeRequest.current === request
        let timer
        let onAbort
        if (force) setBusy(true)
        try {
          // Race the full response (including JSON decoding) against cancellation.
          // A late reply from an earlier mount must never replace newer data.
          const cancelled = new Promise((resolve, reject) => {
            onAbort = () => reject(new Error('request cancelled or timed out'))
            controller.signal.addEventListener('abort', onAbort, { once: true })
            timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
          })
          const pending = (async () => {
            const response = await fetch(force ? `${API}/refresh` : `${API}/stats`, {
              method: force ? 'POST' : 'GET',
              credentials: 'same-origin',
              headers: force ? { 'content-type': 'application/json' } : undefined,
              body: force ? '{}' : undefined,
              signal: controller.signal,
            })
            if (!response.ok) throw new Error(`HTTP ${response.status}`)
            const body = await response.json()
            const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
            if (!record(body) || body.ok !== true || !record(body.totals) || !record(body.activity) || !record(body.insights)) {
              throw new Error(body?.error?.message ?? 'malformed response')
            }
            return body
          })()
          const body = await Promise.race([pending, cancelled])
          if (!isCurrent()) return
          setState(previous => {
            // A stats response started before an avatar save must not undo it.
            const profile = request.avatarRevision !== avatarRevision.current && previous.data?.profile
              ? { ...body.profile, avatarUrl: previous.data.profile.avatarUrl, customAvatar: previous.data.profile.customAvatar }
              : body.profile
            return { status: 'ready', data: { ...body, profile }, error: null }
          })
        } catch (error) {
          if (!isCurrent()) return
          setState((previous) => previous.status === 'ready'
            ? { ...previous, error: error instanceof Error ? error.message : String(error) }
            : { status: 'error', data: null, error: error instanceof Error ? error.message : String(error) })
        } finally {
          clearTimeout(timer)
          if (onAbort !== undefined) controller.signal.removeEventListener('abort', onAbort)
          if (isCurrent()) {
            activeRequest.current = null
            setBusy(false)
          }
        }
      }, [])

      useEffect(() => { void load(false) }, [load])

      const data = state.data
      const totals = data?.totals ?? {}
      const tokenTotals = totals.tokens ?? {}
      const peak = data?.peak ?? {}
      const longest = data?.longestTask ?? {}
      const streaks = data?.streaks ?? {}
      const profile = data?.profile ?? {}

      const name = typeof profile.name === 'string' && profile.name !== '' ? profile.name : '—'
      const monogram = name === '—' ? '?' : name.trim().charAt(0).toUpperCase()
      const subtitle = fill(t('totalsLine'), {
        sessions: Number(totals.sessions) || 0,
        turns: Number(totals.turns) || 0,
        steps: Number(totals.steps) || 0,
      })

      const head = h('div', { className: 'pi-head' },
        h('div', null,
          h('h1', { className: 'pi-title' }, t('title')),
          h('p', { className: 'pi-intro' }, t('intro')),
        ),
        h('button', {
          type: 'button',
          className: 'pi-btn pi-refresh',
          'aria-busy': busy,
          disabled: busy || state.status === 'loading',
          onClick: () => { void load(true) },
        },
          h('span', { className: `pi-btnIcon${busy ? ' pi-spin' : ''}`, 'aria-hidden': true }, h(RefreshIcon)),
          h('span', { className: 'pi-btnLabel' }, busy ? t('refreshing') : t('refresh')),
        ),
      )

      if (state.status === 'loading') {
        return h('section', { className: 'pi-page' },
          h('style', null, CSS),
          head,
          h('div', { className: 'pi-card' },
            h('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
              h('div', { className: 'pi-skeleton', style: { width: '38%' } }),
              h('div', { className: 'pi-skeleton', style: { width: '62%' } }),
              h('div', { className: 'pi-skeleton', style: { width: '48%' } }),
            ),
          ),
          h('div', { className: 'pi-state' }, h('p', { className: 'pi-stateBody' }, t('loading'))),
        )
      }

      if (state.status === 'error') {
        return h('section', { className: 'pi-page' },
          h('style', null, CSS),
          head,
          h('div', { className: 'pi-card' },
            h('div', { className: 'pi-state' },
              h('p', { className: 'pi-stateTitle' }, t('errorTitle')),
              h('p', { className: 'pi-stateBody' }, t('errorBody')),
              h('button', { type: 'button', className: 'pi-btn', disabled: busy, onClick: () => { void load(true) } }, busy ? t('refreshing') : t('retry')),
            ),
          ),
        )
      }

      const hasAny = (Number(tokenTotals.total) || 0) > 0 || (Number(totals.sessions) || 0) > 0

      return h('section', { className: 'pi-page' },
        h('style', null, CSS),
        head,
        state.error ? h('p', { className: 'pi-refreshError', role: 'alert' }, t('refreshError')) : null,
        h(Identity, { profile, name, monogram, subtitle, t, onAvatarChange: next => {
          avatarRevision.current += 1
          setState(previous => previous.data ? { ...previous, data: { ...previous.data, profile: { ...previous.data.profile, avatarUrl: next.avatarUrl, customAvatar: next.customAvatar } } } : previous)
        } }),
        hasAny
          ? h('div', { className: 'pi-metrics' },
            h(Metric, {
              label: t('metricTokens'),
              value: formatTokens(tokenTotals.total),
              unit: '',
              caption: fill(t('metricTokensCaption'), {
                input: formatTokens(tokenTotals.input),
                output: formatTokens(tokenTotals.output),
              }),
            }),
            h(Metric, {
              label: t('metricPeak'),
              value: formatTokens(peak.tokens),
              unit: '',
              caption: typeof peak.date === 'string' && peak.date !== ''
                ? fill(t('metricPeakCaption'), { date: formatDay(peak.date, locale) })
                : t('metricPeakEmpty'),
            }),
            h(Metric, {
              label: t('metricLongest'),
              value: formatDuration(longest.ms, t),
              unit: '',
              caption: typeof longest.title === 'string' && longest.title !== ''
                ? fill(t('metricLongestCaption'), { title: longest.title })
                : t('metricLongestEmpty'),
            }),
            h(Metric, {
              label: t('metricLongestStreak'),
              value: String(Number(streaks.longest) || 0),
              unit: t('unitDay'),
              caption: typeof streaks.longestEnd === 'string' && streaks.longestEnd !== ''
                ? fill(t('metricLongestStreakCaption'), { date: formatDay(streaks.longestEnd, locale) })
                : t('metricLongestStreakEmpty'),
            }),
            h(Metric, {
              label: t('metricCurrentStreak'),
              value: String(Number(streaks.current) || 0),
              unit: t('unitDay'),
              caption: t('metricCurrentStreakCaption'),
            }),
          )
          : h('div', { className: 'pi-card' },
            h('div', { className: 'pi-state' },
              h('p', { className: 'pi-stateTitle' }, t('emptyTitle')),
              h('p', { className: 'pi-stateBody' }, t('emptyBody')),
            ),
          ),
        h(Heatmap, { activity: data?.activity, mode, onMode: setMode, t, locale }),
        h(Insights, { insights: data?.insights, t }),
      )
    }

    // -----------------------------------------------------------------------
    // Registration
    // -----------------------------------------------------------------------

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'profile-insights: dictionaries')
        const t = ctx.locale.bind(NS)

        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: 'profile-insights',
          order: 10,
          label: () => t('panel'),
          locale: NS,
        }, Icon))

        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: 'profile-insights',
          locale: NS,
        }, Page))
      },
    }
  },
})
