import { useState, lazy, Suspense } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { parseMood } from '../utils/mood.js'

// Code-split Recharts to keep initial bundle size lightweight (<200 kB)
const MoodTrendChart = lazy(() => import('./MoodTrendChart.jsx'))

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

function ChartLoadingSkeleton() {
  return (
    <div className="h-64 w-full rounded-2xl bg-slate-100 p-4 border border-slate-200 flex flex-col justify-between animate-shimmer">
      <div className="flex justify-between items-center">
        <div className="h-4 w-32 rounded bg-slate-200" />
        <div className="h-4 w-20 rounded bg-slate-200" />
      </div>
      <div className="h-36 w-full rounded bg-slate-200/60" />
      <div className="flex justify-between">
        <div className="h-3 w-12 rounded bg-slate-200" />
        <div className="h-3 w-12 rounded bg-slate-200" />
        <div className="h-3 w-12 rounded bg-slate-200" />
      </div>
    </div>
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
    <motion.div
      data-testid="mood-trend-view"
      layout
      transition={{ type: 'spring', stiffness: 350, damping: 30 }}
      className="bg-white rounded-3xl border-2 border-purple-200/90 p-5 sm:p-7 shadow-xs relative overflow-hidden transition-all duration-300"
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
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-purple-100 text-purple-950 border border-purple-300">
                  Last 7 Check-Ins
                </span>
              </div>
              <p className="text-xs text-slate-600 mt-0.5 font-medium">
                Emotional trajectory and daily check-ins for {seniorName}
              </p>
            </div>
          </div>
        </div>

        {/* View Mode Toggle Pill Switcher with Motion-based Morphing Indicator */}
        {!loading && last7Moods.length > 0 && (
          <div className="flex items-center bg-slate-100/90 p-1 rounded-xl self-start sm:self-auto border border-slate-200 relative">
            <button
              type="button"
              data-testid="mood-toggle-emoji"
              onClick={() => setViewMode('emoji')}
              className={`relative z-10 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'emoji' ? 'text-purple-950 font-black' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {viewMode === 'emoji' && (
                <motion.div
                  layoutId="mood-view-mode-pill"
                  className="absolute inset-0 bg-white rounded-lg shadow-xs border border-purple-200/80"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <span className="relative z-10 select-none">😊</span>
              <span className="relative z-10">Emoji Row</span>
            </button>

            <button
              type="button"
              data-testid="mood-toggle-chart"
              onClick={() => setViewMode('chart')}
              className={`relative z-10 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
                viewMode === 'chart' ? 'text-purple-950 font-black' : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              {viewMode === 'chart' && (
                <motion.div
                  layoutId="mood-view-mode-pill"
                  className="absolute inset-0 bg-white rounded-lg shadow-xs border border-purple-200/80"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                />
              )}
              <span className="relative z-10 select-none">📈</span>
              <span className="relative z-10">Recharts Trend</span>
            </button>
          </div>
        )}
      </div>

      {/* Main Content Area */}
      <div className="pt-5">
        <AnimatePresence mode="wait">
          {loading ? (
            /* ======================================================== */
            /* 1. LOADING STATE                                         */
            /* ======================================================== */
            <motion.div
              key="loading-state"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              data-testid="mood-loading-state"
              className="space-y-4 py-4"
            >
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
            </motion.div>
          ) : last7Moods.length === 0 ? (
            /* ======================================================== */
            /* 2. EMPTY STATE                                           */
            /* ======================================================== */
            <motion.div
              key="empty-state"
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
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
            </motion.div>
          ) : (
            /* ======================================================== */
            /* 3. ACTIVE DATA VIEW: EMOJI ROW OR RECHARTS LINE CHART    */
            /* ======================================================== */
            <motion.div
              key="active-data-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-5"
            >
              {/* Top Trajectory / Average Badge */}
              {averageScore && (
                <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-purple-50/90 border border-purple-200 shadow-2xs">
                  <div className="flex items-center space-x-2.5">
                    <span className="text-xl select-none">✨</span>
                    <div>
                      <span className="text-xs font-bold text-purple-950 uppercase tracking-wide">
                        7-Check-In Summary:{' '}
                      </span>
                      <span className="text-xs font-black text-purple-900">
                        {getSummaryText()}
                      </span>
                    </div>
                  </div>
                  <div className="text-xs font-mono font-black text-purple-950 bg-white px-3 py-1 rounded-xl border border-purple-300 shadow-2xs">
                    Mood Index: {averageScore} / 5.0
                  </div>
                </div>
              )}

              {/* VIEW A: EMOJI ROW VIEW */}
              {viewMode === 'emoji' && (
                <motion.div
                  key="emoji-view"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  data-testid="mood-emoji-row"
                  className="space-y-4"
                >
                  <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    Chronological Check-In Flow (Tap card for details)
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-2.5">
                    {chronologicalMoods.map((item, index) => {
                      const isLatest = index === chronologicalMoods.length - 1
                      const isSelected = activeDetail?.id === item.id

                      return (
                        <motion.button
                          key={item.id}
                          type="button"
                          data-testid="mood-emoji-item"
                          onClick={() => setSelectedCheckInId(item.id)}
                          whileHover={{ scale: 1.03, y: -2 }}
                          whileTap={{ scale: 0.97 }}
                          className={`text-left p-3.5 rounded-2xl border-2 transition-all duration-200 cursor-pointer flex flex-col justify-between min-h-[110px] relative ${
                            isSelected
                              ? `${item.parsedMood.bgClass} ${item.parsedMood.borderClass} ring-3 ring-purple-300 shadow-md`
                              : 'bg-slate-50/80 hover:bg-white border-slate-200 hover:border-purple-300 shadow-2xs hover:shadow-xs'
                          }`}
                        >
                          {isLatest && (
                            <span className="absolute -top-2 -right-1 bg-purple-700 text-white text-[10px] font-black px-1.5 py-0.5 rounded-full shadow-xs">
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
                            <div className="text-[10px] font-semibold text-slate-500 mt-0.5">
                              {item.shortTime}
                            </div>
                          </div>
                        </motion.button>
                      )
                    })}
                  </div>
                </motion.div>
              )}

              {/* VIEW B: RECHARTS LINE CHART VIEW */}
              {viewMode === 'chart' && (
                <motion.div
                  key="chart-view"
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  className="min-w-0"
                >
                  <Suspense fallback={<ChartLoadingSkeleton />}>
                    <MoodTrendChart chronologicalMoods={chronologicalMoods} />
                  </Suspense>
                </motion.div>
              )}

              {/* MORPHING CARD DETAIL CALLOUT */}
              <AnimatePresence mode="wait">
                {activeDetail && (
                  <motion.div
                    key={activeDetail.id}
                    layout
                    initial={{ opacity: 0, scale: 0.98, y: 8 }}
                    animate={{ opacity: 1, scale: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.98, y: -8 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    data-testid="mood-active-detail"
                    className={`p-4 rounded-2xl border-2 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${activeDetailParsed.bgClass} ${activeDetailParsed.borderClass}`}
                  >
                    <div className="flex items-center space-x-3.5 min-w-0">
                      <span className="text-4xl select-none shrink-0">{activeDetailParsed.emoji}</span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm sm:text-base font-black text-slate-900">
                            {activeDetailParsed.label}
                          </span>
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${activeDetailParsed.badgeBg}`}
                          >
                            Score: {activeDetailParsed.score} / 5
                          </span>
                        </div>
                        <p className="text-xs sm:text-sm font-semibold text-slate-800 mt-0.5 break-words">
                          "{activeDetail.status}"
                        </p>
                      </div>
                    </div>

                    <div className="text-left sm:text-right shrink-0">
                      <span className="text-xs font-mono font-semibold text-slate-600 block">
                        {formatFullTime(activeDetail.timestamp)}
                      </span>
                      <span className="text-xs font-black text-purple-800 bg-purple-100 border border-purple-200 px-2.5 py-0.5 rounded-md mt-1 inline-block">
                        Verified Check-In
                      </span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
