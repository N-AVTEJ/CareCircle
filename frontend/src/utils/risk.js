/**
 * Human-readable one-line reason built from breakdown.
 * Example output: "Skipped 2 meals, mood low 3 days"
 */
export function formatRiskReason(breakdown = {}) {
  const { missedPills = 0, skippedMeals = 0, badMoodStreak = 0 } = breakdown
  const reasons = []

  if (missedPills > 0) {
    reasons.push(`Missed ${missedPills} pill${missedPills > 1 ? 's' : ''}`)
  }
  if (skippedMeals > 0) {
    reasons.push(`Skipped ${skippedMeals} meal${skippedMeals > 1 ? 's' : ''}`)
  }
  if (badMoodStreak > 0) {
    reasons.push(`mood low ${badMoodStreak} day${badMoodStreak > 1 ? 's' : ''}`)
  }

  if (reasons.length === 0) {
    return 'All check-ins on track'
  }
  return reasons.join(', ')
}

/**
 * Returns color coding and styles according to risk score:
 * green < 40, yellow 40-70, red > 70
 */
export function getRiskTheme(score = 0) {
  if (score < 40) {
    return {
      level: 'LOW',
      hex: '#10b981', // emerald-500
      trackHex: '#e2e8f0', // slate-200
      badgeBg: 'bg-emerald-100 text-emerald-900 border-emerald-300',
      cardBg: 'bg-gradient-to-br from-emerald-50/70 via-white to-teal-50/30',
      borderClass: 'border-emerald-300',
      textAccent: 'text-emerald-700',
      subtext: 'Care recipient is active with no adverse check-in patterns detected.',
    }
  }
  if (score < 70) {
    return {
      level: 'MEDIUM',
      hex: '#f59e0b', // amber-500
      trackHex: '#fef3c7', // amber-100
      badgeBg: 'bg-amber-100 text-amber-900 border-amber-300',
      cardBg: 'bg-gradient-to-br from-amber-50/70 via-white to-yellow-50/30',
      borderClass: 'border-amber-300',
      textAccent: 'text-amber-700',
      subtext: 'Multiple missed check-ins or low moods detected. Check in soon.',
    }
  }
  return {
    level: 'HIGH',
    hex: '#ef4444', // red-500
    trackHex: '#fee2e2', // red-100
    badgeBg: 'bg-red-100 text-red-950 border-red-300 animate-pulse',
    cardBg: 'bg-gradient-to-br from-red-50/80 via-white to-rose-50/40',
    borderClass: 'border-red-400',
    textAccent: 'text-red-700',
    subtext: 'Significant risk detected. Reach out to verify wellbeing immediately.',
  }
}
