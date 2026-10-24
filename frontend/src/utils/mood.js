/**
 * Standardized mood definitions for CareCircle daily wellbeing tracking.
 */
export const MOOD_LEVELS = {
  1: {
    emoji: '😔',
    label: 'Down / Needs Comfort',
    score: 1,
    color: '#f43f5e',
    bgClass: 'bg-rose-50',
    borderClass: 'border-rose-400',
    textClass: 'text-rose-950',
    badgeBg: 'bg-rose-100 text-rose-900 border-rose-300',
  },
  2: {
    emoji: '😴',
    label: 'Tired / Low Energy',
    score: 2,
    color: '#f59e0b',
    bgClass: 'bg-amber-50',
    borderClass: 'border-amber-400',
    textClass: 'text-amber-950',
    badgeBg: 'bg-amber-100 text-amber-900 border-amber-300',
  },
  3: {
    emoji: '😌',
    label: 'Calm & Peaceful',
    score: 3,
    color: '#8b5cf6',
    bgClass: 'bg-purple-50',
    borderClass: 'border-purple-400',
    textClass: 'text-purple-950',
    badgeBg: 'bg-purple-100 text-purple-900 border-purple-300',
  },
  4: {
    emoji: '😊',
    label: 'Good & Cheerful',
    score: 4,
    color: '#3b82f6',
    bgClass: 'bg-blue-50',
    borderClass: 'border-blue-400',
    textClass: 'text-blue-950',
    badgeBg: 'bg-blue-100 text-blue-900 border-blue-300',
  },
  5: {
    emoji: '😄',
    label: 'Great & Energized',
    score: 5,
    color: '#10b981',
    bgClass: 'bg-emerald-50',
    borderClass: 'border-emerald-400',
    textClass: 'text-emerald-950',
    badgeBg: 'bg-emerald-100 text-emerald-900 border-emerald-300',
  },
}

/**
 * Parses a check-in status string and categorizes it into a 1–5 wellbeing scale.
 * Prioritizes negations and distress signals to avoid false positives in health contexts.
 */
export function parseMood(status = '') {
  const s = String(status || '').toLowerCase().trim()

  // 1. Check for negative sentiments, distress, illness, or negations (CRITICAL: must check first)
  const isNegationOrDistress =
    s.includes('not good') ||
    s.includes('not feeling well') ||
    s.includes('not feeling good') ||
    s.includes('not well') ||
    s.includes('not okay') ||
    s.includes('not great') ||
    s.includes('not happy') ||
    s.includes("don't feel good") ||
    s.includes("didn't feel good") ||
    s.includes('sad') ||
    s.includes('down') ||
    s.includes('unwell') ||
    s.includes('pain') ||
    s.includes('hurting') ||
    s.includes('lonely') ||
    s.includes('anxious') ||
    s.includes('worried') ||
    s.includes('crying') ||
    s.includes('depressed') ||
    s.includes('sick') ||
    s.includes('bad') ||
    s.includes('terrible') ||
    s.includes('awful') ||
    s.includes('poor') ||
    s.includes('struggling') ||
    s.includes('heartbroken') ||
    /[😔😢😭🤒🤕💔😞😟😰😿]/u.test(s)

  if (isNegationOrDistress) {
    return MOOD_LEVELS[1]
  }

  // 2. Check for tired, fatigued, or low energy state
  const isTired =
    s.includes('tired') ||
    s.includes('sleepy') ||
    s.includes('fatigued') ||
    s.includes('exhausted') ||
    s.includes('low energy') ||
    s.includes('drained') ||
    s.includes('weary') ||
    s.includes('sluggish') ||
    s.includes('weak') ||
    s.includes('drowsy') ||
    /[😴🥱😮‍💨😪]/u.test(s)

  if (isTired) {
    return MOOD_LEVELS[2]
  }

  // 3. Check for high energy / exceptional / ecstatic state (Score 5)
  const isGreat =
    s.includes('great') ||
    s.includes('amazing') ||
    s.includes('wonderful') ||
    s.includes('energized') ||
    s.includes('joy') ||
    s.includes('ecstatic') ||
    s.includes('fantastic') ||
    s.includes('thriving') ||
    s.includes('blessed') ||
    s.includes('excellent') ||
    s.includes('superb') ||
    /[😄😃🤩🥳💪🎉🌟✨🚀]/u.test(s)

  if (isGreat) {
    return MOOD_LEVELS[5]
  }

  // 4. Check for good / cheerful / positive state (Score 4)
  const isGood =
    s.includes('good') ||
    s.includes('cheerful') ||
    s.includes('happy') ||
    s.includes('fine') ||
    s.includes('feeling good') ||
    s.includes('smiling') ||
    s.includes('pleasant') ||
    s.includes('doing well') ||
    s.includes('bright') ||
    /[😊🙂🌸🌻🌞]/u.test(s)

  if (isGood) {
    return MOOD_LEVELS[4]
  }

  // 5. Check for calm / peaceful / resting state (Score 3)
  const isCalm =
    s.includes('calm') ||
    s.includes('peaceful') ||
    s.includes('relaxed') ||
    s.includes('okay') ||
    s.includes('rested') ||
    s.includes('content') ||
    s.includes('quiet') ||
    s.includes('steady') ||
    s.includes('normal') ||
    /[😌🧘🕊️☕🌤️]/u.test(s)

  if (isCalm) {
    return MOOD_LEVELS[3]
  }

  // 6. Safe neutral fallback for unspecified check-ins
  return MOOD_LEVELS[3]
}
