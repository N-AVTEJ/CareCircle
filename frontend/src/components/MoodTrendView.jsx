import { useState } from 'react'
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts'
import { parseMood } from '../utils/mood.js'

function formatShortTime(timestamp) {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  if (isNaN(d.getTime())) return ''
  const isToday = new Date().toDateString() === d.toDateString()
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return isToday ? time : `${d.getMonth() + 1}/${d.getDate()} ${time}`
}

function formatFullTime(timestamp) {
  if (!timestamp) return ''
  const d = new Date(timestamp)
  if (isNaN(d.getTime())) return ''
  return d.toLocaleString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

// Custom Tooltip for Recharts Line Chart
function CustomChartTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null
  const item = payload[0].payload
  const mood = item.parsedMood

  return (
    <div className="bg-white/95 backdrop-blur-md p-3.5 rounded-2xl shadow-xl border-2 border-purple-200 text-xs text-slate-800 space-y-1.5 max-w-xs">
      <div className="flex items-center space-x-2">
        <span className="text-2xl select-none">{mood.emoji}</span>
        <div>
          <div className="font-extrabold text-sm text-slate-900">{mood.label}</div>
          <div className="text-[11px] text-slate-500">{item.fullTime}</div>
        </div>
      </div>
      <div className="pt-1 border-t border-slate-100 text-slate-700 italic">
        "{item.status}"
      </div>
    </div>
  )
}

// Custom Dot for Recharts
function CustomChartDot(props) {
  const { cx, cy, payload } = props
  if (!cx || !cy) return null
  const mood = payload.parsedMood
  return (
    <g transform={`translate(${cx},${cy})`}>
      <circle r="14" fill="#ffffff" stroke={mood.color} strokeWidth="2.5" />
      <text
        x="0"
        y="4"
        textAnchor="middle"
        fontSize="12"
        className="select-none"
        style={{ cursor: 'pointer' }}
      >
        {mood.emoji}
      </text>
    </g>
  )
}

export default function MoodTrendView({
  moodCheckIns = [],
  loading = false,
  seniorName = 'Senior',
}) {
  const [viewMode, setViewMode] = useState('emoji') // 'emoji' | 'chart'
  const [selectedCheckInId, setSelectedCheckInId] = useState(null)

  // Last 7 mood check-ins (newest first in raw check-ins)
  const last7Moods = moodCheckIns.slice(0, 7)

  // Chronological order (oldest to newest) for line chart & timeline flow
  const chronologicalMoods = [...last7Moods].reverse().map((item, idx) => {
    const parsedMood = parseMood(item.status)
    return {
      ...item,
      chartIndex: idx + 1,
      score: parsedMood.score,
      shortTime: formatShortTime(item.timestamp),
      fullTime: formatFullTime(item.timestamp),
      parsedMood,
    }
  })

  // Selected check-in for detailed morphing view
  const activeDetail =
    last7Moods.find((m) => m.id === selectedCheckInId) || last7Moods[0] || null
  const activeDetailParsed = activeDetail ? parseMood(activeDetail.status) : null

  // Calculate wellbeing summary
  const averageScore =
    chronologicalMoods.length > 0
      ? (
          chronologicalMoods.reduce((sum, item) => sum + item.score, 0) /
          chronologicalMoods.length
        ).toFixed(1)
      : null

  const getSummaryText = () => {
    if (!averageScore) return ''
    const scoreNum = parseFloat(averageScore)
    if (scoreNum >= 4.2) return 'Consistently high, positive & cheerful'
    if (scoreNum >= 3.2) return 'Stable, calm & contented emotional state'
    if (scoreNum >= 2.2) return 'Fluctuating or mild fatigue noted'
    return 'Lower mood observed — consider calling to check in'
  }

  return (
    <div
      data-testid="mood-trend-view"
      className="bg-white rounded-3xl border-2 border-purple-200/80 p-6 sm:p-7 shadow-xs relative overflow-hidden transition-all duration-300"
    >
      {/* Decorative top accent glow */}
      <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-purple-500 via-indigo-500 to-pink-500" />

      {/* Header with Title and Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-purple-100">
        <div>
          <div className="flex items-center space-x-2.5">
            <span className="text-2xl select-none" role="img" aria-label="Mood Trend">
              🌈
            </span>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight">
                  Mood & Wellbeing Trend
                </h3>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-900 border border-purple-300">
                  Last 7 Check-Ins
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">
                Emotional trajectory and daily check-ins for {seniorName}
              </p>
            </div>
          </div>
        </div>

        {/* View Mode Toggle Pill Switcher */}
        {!loading && last7Moods.length > 0 && (
          <div className="flex items-center bg-slate-100 p-1 rounded-xl self-start sm:self-auto border border-slate-200/70">
            <button
              type="button"
              data-testid="mood-toggle-emoji"
              onClick={() => setViewMode('emoji')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'emoji'
                  ? 'bg-white text-purple-950 shadow-xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>😊</span>
              <span>Emoji Row</span>
            </button>
            <button
              type="button"
              data-testid="mood-toggle-chart"
              onClick={() => setViewMode('chart')}
              className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'chart'
                  ? 'bg-white text-purple-950 shadow-xs font-extrabold'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <span>📈</span>
              <span>Recharts Trend</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area: Loading, Empty, or Data Views */}
      <div className="pt-5">
        {loading ? (
          /* ======================================================== */
          /* 1. LOADING STATE                                         */
          /* ======================================================== */
          <div data-testid="mood-loading-state" className="space-y-4 py-4">
            <div className="flex items-center justify-between">
              <div className="h-4 w-40 rounded-md animate-shimmer" />
              <div className="h-4 w-24 rounded-md animate-shimmer" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-3">
              {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                <div
                  key={i}
                  className="h-28 rounded-2xl border border-slate-200 p-3 flex flex-col justify-between animate-shimmer"
                >
                  <div className="w-8 h-8 rounded-full bg-slate-200/60 mx-auto" />
                  <div className="h-3 w-12 rounded bg-slate-200/60 mx-auto" />
                </div>
              ))}
            </div>
            <div className="h-14 rounded-2xl animate-shimmer" />
          </div>
        ) : last7Moods.length === 0 ? (
          /* ======================================================== */
          /* 2. EMPTY STATE                                           */
          /* ======================================================== */
          <div
            data-testid="mood-empty-state"
            className="text-center py-10 px-4 rounded-2xl bg-purple-50/50 border-2 border-dashed border-purple-200"
          >
            <div className="w-16 h-16 mx-auto rounded-2xl bg-purple-100 border border-purple-300 flex items-center justify-center text-3xl shadow-xs select-none">
              😊
            </div>
            <h4 className="mt-3 text-base sm:text-lg font-black text-slate-900">
              No Mood Check-Ins Recorded Yet
            </h4>
            <p className="mt-1 text-xs sm:text-sm text-slate-600 max-w-md mx-auto leading-relaxed">
              When {seniorName} taps the <strong>Mood</strong> button from the Senior view or an
              update is logged, the last 7 check-ins and wellbeing line chart will automatically
              appear here in real time.
            </p>
            <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white border border-purple-200 text-xs font-bold text-purple-900 shadow-2xs">
              <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
              Waiting for first mood check-in over Socket.io
            </div>
          </div>
        ) : (
          /* ======================================================== */
          /* 3. ACTIVE DATA VIEW: EMOJI ROW OR RECHARTS LINE CHART    */
          /* ======================================================== */
          <div className="space-y-5">
            {/* Top Trajectory / Average Badge */}
            {averageScore && (
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-purple-50/80 border border-purple-200">
                <div className="flex items-center space-x-2.5">
                  <span className="text-xl">✨</span>
                  <div>
                    <span className="text-xs font-bold text-purple-950 uppercase tracking-wide">
                      7-Check-In Summary:{' '}
                    </span>
                    <span className="text-xs font-extrabold text-purple-900">
                      {getSummaryText()}
                    </span>
                  </div>
                </div>
                <div className="text-xs font-mono font-bold text-purple-800 bg-white px-2.5 py-1 rounded-lg border border-purple-200">
                  Mood Index: {averageScore} / 5.0
                </div>
              </div>
            )}

            {/* VIEW A: EMOJI ROW VIEW */}
            {viewMode === 'emoji' && (
              <div data-testid="mood-emoji-row" className="space-y-4">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Chronological Check-In Flow (Tap card for details)
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5">
                  {chronologicalMoods.map((item, index) => {
                    const isLatest = index === chronologicalMoods.length - 1
                    const isSelected = activeDetail?.id === item.id

                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-testid="mood-emoji-item"
                        onClick={() => setSelectedCheckInId(item.id)}
                        className={`text-left p-3.5 rounded-2xl border-2 transition-all duration-200 transform cursor-pointer flex flex-col justify-between min-h-[110px] relative ${
                          isSelected
                            ? `${item.parsedMood.bgClass} ${item.parsedMood.borderClass} ring-3 ring-purple-300 shadow-md scale-[1.02]`
                            : 'bg-slate-50/80 hover:bg-white border-slate-200 hover:border-purple-300 shadow-2xs hover:shadow-xs'
                        }`}
                      >
                        {isLatest && (
                          <span className="absolute -top-2 -right-1 bg-purple-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow-xs">
                            Latest
                          </span>
                        )}

                        <div className="text-3xl sm:text-4xl text-center select-none py-1">
                          {item.parsedMood.emoji}
                        </div>

                        <div className="mt-1 text-center">
                          <div className="text-xs font-extrabold text-slate-800 truncate">
                            {item.parsedMood.label.split('&')[0].trim()}
                          </div>
                          <div className="text-[10px] font-medium text-slate-500 mt-0.5">
                            {item.shortTime}
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* VIEW B: RECHARTS LINE CHART VIEW */}
            {viewMode === 'chart' && (
              <div data-testid="mood-chart-view" className="space-y-3">
                <div className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Mood Trajectory Graph (1: Low 😔 to 5: Energized 😄)
                </div>

                <div className="h-64 w-full bg-slate-50/70 p-3 rounded-2xl border border-slate-200">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chronologicalMoods}
                      margin={{ top: 15, right: 20, left: -20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                      <XAxis
                        dataKey="shortTime"
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        tickLine={false}
                      />
                      <YAxis
                        domain={[1, 5]}
                        ticks={[1, 2, 3, 4, 5]}
                        tick={{ fontSize: 11, fill: '#64748b' }}
                        tickLine={false}
                      />
                      <Tooltip content={<CustomChartTooltip />} />
                      <Line
                        type="monotone"
                        dataKey="score"
                        stroke="#8b5cf6"
                        strokeWidth={3}
                        dot={<CustomChartDot />}
                        activeDot={{ r: 16, stroke: '#6d28d9', strokeWidth: 3 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {/* MORPHING CARD DETAIL CALLOUT */}
            {activeDetail && (
              <div
                data-testid="mood-active-detail"
                className={`p-4 rounded-2xl border-2 transition-all duration-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${activeDetailParsed.bgClass} ${activeDetailParsed.borderClass}`}
              >
                <div className="flex items-center space-x-3.5">
                  <span className="text-4xl select-none">{activeDetailParsed.emoji}</span>
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-sm sm:text-base font-black text-slate-900">
                        {activeDetailParsed.label}
                      </span>
                      <span
                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${activeDetailParsed.badgeBg}`}
                      >
                        Score: {activeDetailParsed.score} / 5
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm font-semibold text-slate-800 mt-0.5">
                      "{activeDetail.status}"
                    </p>
                  </div>
                </div>

                <div className="text-left sm:text-right shrink-0">
                  <span className="text-xs font-mono font-medium text-slate-500 block">
                    {formatFullTime(activeDetail.timestamp)}
                  </span>
                  <span className="text-xs font-bold text-purple-700 bg-purple-100 px-2 py-0.5 rounded-md mt-1 inline-block">
                    Verified Check-In
                  </span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
