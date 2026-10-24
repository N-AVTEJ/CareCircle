export function parseMood(status = '') {
  const s = String(status).toLowerCase()
  if (
    s.includes('great') ||
    s.includes('amazing') ||
    s.includes('wonderful') ||
    s.includes('energized') ||
    s.includes('joy') ||
    s.includes('ecstatic')
  ) {
    return {
      emoji: '😄',
      label: 'Great & Energized',
      score: 5,
      color: '#10b981',
      bgClass: 'bg-emerald-50',
      borderClass: 'border-emerald-400',
      textClass: 'text-emerald-950',
      badgeBg: 'bg-emerald-100 text-emerald-900 border-emerald-300',
    }
  }
  if (
    s.includes('good') ||
    s.includes('cheerful') ||
    s.includes('happy') ||
    s.includes('fine') ||
    s.includes('feeling good')
  ) {
    return {
      emoji: '😊',
      label: 'Good & Cheerful',
      score: 4,
      color: '#3b82f6',
      bgClass: 'bg-blue-50',
      borderClass: 'border-blue-400',
      textClass: 'text-blue-950',
      badgeBg: 'bg-blue-100 text-blue-900 border-blue-300',
    }
  }
  if (
    s.includes('calm') ||
    s.includes('peaceful') ||
    s.includes('relaxed') ||
    s.includes('okay') ||
    s.includes('rested')
  ) {
    return {
      emoji: '😌',
      label: 'Calm & Peaceful',
      score: 3,
      color: '#8b5cf6',
      bgClass: 'bg-purple-50',
      borderClass: 'border-purple-400',
      textClass: 'text-purple-950',
      badgeBg: 'bg-purple-100 text-purple-900 border-purple-300',
    }
  }
  if (
    s.includes('tired') ||
    s.includes('sleepy') ||
    s.includes('fatigued') ||
    s.includes('exhausted') ||
    s.includes('low energy')
  ) {
    return {
      emoji: '😴',
      label: 'Tired / Low Energy',
      score: 2,
      color: '#f59e0b',
      bgClass: 'bg-amber-50',
      borderClass: 'border-amber-400',
      textClass: 'text-amber-950',
      badgeBg: 'bg-amber-100 text-amber-900 border-amber-300',
    }
  }
  if (
    s.includes('sad') ||
    s.includes('down') ||
    s.includes('unwell') ||
    s.includes('pain') ||
    s.includes('lonely') ||
    s.includes('anxious') ||
    s.includes('worried')
  ) {
    return {
      emoji: '😔',
      label: 'Down / Needs Comfort',
      score: 1,
      color: '#f43f5e',
      bgClass: 'bg-rose-50',
      borderClass: 'border-rose-400',
      textClass: 'text-rose-950',
      badgeBg: 'bg-rose-100 text-rose-900 border-rose-300',
    }
  }
  // Default mood
  return {
    emoji: '😊',
    label: 'Feeling Good',
    score: 4,
    color: '#8b5cf6',
    bgClass: 'bg-purple-50',
    borderClass: 'border-purple-400',
    textClass: 'text-purple-950',
    badgeBg: 'bg-purple-100 text-purple-900 border-purple-300',
  }
}
