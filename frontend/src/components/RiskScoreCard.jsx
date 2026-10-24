import { motion } from 'motion/react'
import { formatRiskReason, getRiskTheme } from '../utils/risk.js'

export default function RiskScoreCard({
  riskScore = 0,
  breakdown = { missedPills: 0, skippedMeals: 0, badMoodStreak: 0 },
  level = 'LOW',
  loading = false,
  seniorName = 'Senior',
  onRefresh,
}) {
  const safeScore = Math.max(0, Math.min(100, Math.round(Number(riskScore) || 0)))
  const theme = getRiskTheme(safeScore)
  const reasonText = formatRiskReason(breakdown)

  // SVG circular progress geometry
  const radius = 44
  const strokeWidth = 9
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (safeScore / 100) * circumference

  return (
    <motion.div
      data-testid="risk-score-card"
      layout
      transition={{ type: 'spring', stiffness: 350, damping: 28 }}
      className={`rounded-3xl border-2 ${theme.borderClass} ${theme.cardBg} p-6 sm:p-7 shadow-xs relative overflow-hidden transition-all duration-300`}
    >
      {/* Top Header Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5 pb-4 border-b border-slate-200/80">
        <div className="flex items-center space-x-3">
          <div className="w-10 h-10 rounded-2xl bg-white border border-slate-200 shadow-2xs flex items-center justify-center text-xl select-none">
            🛡️
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <h3 className="text-lg font-bold text-slate-900 tracking-tight">
                7-Day Health Risk Assessment
              </h3>
              <span
                data-testid="risk-score-level"
                className={`text-xs font-black px-2.5 py-0.5 rounded-full border ${theme.badgeBg}`}
              >
                {level || theme.level} RISK
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Rule-based safety index for {seniorName} • 7-day rolling window
            </p>
          </div>
        </div>

        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh risk score"
            className="self-end sm:self-auto text-xs font-semibold bg-white hover:bg-slate-50 text-slate-700 px-3 py-1.5 rounded-xl border border-slate-200 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
          >
            {loading ? 'Updating...' : '↻ Recalculate'}
          </button>
        )}
      </div>

      {/* Main Body: Circular Progress Ring & Summary */}
      <div className="flex flex-col md:flex-row items-center gap-6 sm:gap-8">
        {/* SVG Circular Progress Ring */}
        <div className="relative shrink-0 flex items-center justify-center" data-testid="risk-score-ring">
          <svg className="w-32 h-32 -rotate-90 transform" viewBox="0 0 110 110">
            {/* Background Track Circle */}
            <circle
              cx="55"
              cy="55"
              r={radius}
              stroke={theme.trackHex}
              strokeWidth={strokeWidth}
              fill="transparent"
            />
            {/* Animated Active Arc */}
            <motion.circle
              cx="55"
              cy="55"
              r={radius}
              stroke={theme.hex}
              strokeWidth={strokeWidth}
              fill="transparent"
              strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset }}
              transition={{ type: 'spring', stiffness: 50, damping: 15 }}
            />
          </svg>

          {/* Centered Score Label inside Ring */}
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center select-none pointer-events-none">
            <span
              data-testid="risk-score-value"
              className="text-3xl font-black text-slate-900 tracking-tight leading-none"
            >
              {safeScore}
            </span>
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mt-0.5">
              / 100
            </span>
          </div>
        </div>

        {/* Reason Line and Factor Details */}
        <div className="flex-1 space-y-3 text-center md:text-left">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-1">
              Primary Risk Factor Reason
            </div>
            {/* The primary one-line reason built from breakdown */}
            <p
              data-testid="risk-score-reason"
              className="text-lg sm:text-xl font-black text-slate-900 tracking-tight leading-snug"
            >
              {reasonText}
            </p>
            <p className="text-xs text-slate-600 mt-1 font-medium">
              {theme.subtext}
            </p>
          </div>

          {/* Breakdown Chips */}
          <div className="pt-2 flex flex-wrap items-center justify-center md:justify-start gap-2">
            <div
              data-testid="risk-breakdown-pills"
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border ${
                breakdown?.missedPills > 0
                  ? 'bg-rose-50 text-rose-900 border-rose-200'
                  : 'bg-white text-slate-700 border-slate-200'
              }`}
            >
              <span>💊</span>
              <span>{breakdown?.missedPills || 0} missed pills</span>
            </div>

            <div
              data-testid="risk-breakdown-meals"
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border ${
                breakdown?.skippedMeals > 0
                  ? 'bg-amber-50 text-amber-900 border-amber-200'
                  : 'bg-white text-slate-700 border-slate-200'
              }`}
            >
              <span>🍲</span>
              <span>{breakdown?.skippedMeals || 0} skipped meals</span>
            </div>

            <div
              data-testid="risk-breakdown-mood"
              className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold border ${
                breakdown?.badMoodStreak > 0
                  ? 'bg-purple-50 text-purple-900 border-purple-200'
                  : 'bg-white text-slate-700 border-slate-200'
              }`}
            >
              <span>😊</span>
              <span>{breakdown?.badMoodStreak || 0}d low mood streak</span>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
