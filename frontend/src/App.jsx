import { useState, useEffect, useCallback } from 'react'
import { io } from 'socket.io-client'

const API_BASE = ''
const HARDCODED_SENIOR_USER_ID = 'ffd75d01-03e9-4138-abd1-b095ac5ba212'
const DEFAULT_FAMILY_GROUP_ID = 'fam_group_carecircle_101'

export default function App() {
  const [activeView, setActiveView] = useState('SENIOR') // 'SENIOR' | 'FAMILY'
  const [users, setUsers] = useState([])
  const [checkIns, setCheckIns] = useState([])
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [isLive, setIsLive] = useState(false)
  const [socketConnected, setSocketConnected] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  // Senior view quick-feedback state
  const [pendingButton, setPendingButton] = useState(null) // 'PILLS' | 'MEAL' | 'MOOD' | null
  const [checkInFeedback, setCheckInFeedback] = useState(null)

  // Family dashboard form states
  const [customCheckInType, setCustomCheckInType] = useState('PILLS')
  const [customCheckInStatus, setCustomCheckInStatus] = useState('Morning medication taken')
  const [submittingCustomCheckIn, setSubmittingCustomCheckIn] = useState(false)
  const [submittingAlert, setSubmittingAlert] = useState(false)

  const loadData = useCallback(async () => {
    try {
      const [uRes, cRes, aRes] = await Promise.all([
        fetch(`${API_BASE}/api/users`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${API_BASE}/api/checkins`).then((r) => (r.ok ? r.json() : null)),
        fetch(`${API_BASE}/api/alerts`).then((r) => (r.ok ? r.json() : null)),
      ])

      if (uRes && uRes.success) {
        setUsers(uRes.data || [])
        setIsLive(true)
      } else {
        setIsLive(false)
      }

      if (cRes && cRes.success) {
        setCheckIns(cRes.data || [])
      }
      if (aRes && aRes.success) {
        setAlerts(aRes.data || [])
      }
    } catch {
      setIsLive(false)
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial load
  useEffect(() => {
    let ignore = false
    const init = async () => {
      if (!ignore) {
        await loadData()
      }
    }
    init()
    return () => {
      ignore = true
    }
  }, [loadData])

  // Real-time Socket.io listener
  useEffect(() => {
    const socket = io('/', {
      query: { familyGroupId: DEFAULT_FAMILY_GROUP_ID },
      transports: ['websocket', 'polling'],
    })

    socket.on('connect', () => {
      setSocketConnected(true)
      socket.emit('join:family', DEFAULT_FAMILY_GROUP_ID)
    })

    socket.on('disconnect', () => {
      setSocketConnected(false)
    })

    socket.on('checkin:new', (newCheckIn) => {
      setCheckIns((prev) => {
        if (prev.some((c) => c.id === newCheckIn.id)) return prev
        return [newCheckIn, ...prev]
      })
    })

    return () => {
      socket.disconnect()
    }
  }, [])

  // Resolved user models (using seeded data or fallback)
  const seniorUser = users.find((u) => u.role === 'SENIOR') || {
    id: HARDCODED_SENIOR_USER_ID,
    name: 'Eleanor Vance',
    role: 'SENIOR',
    phone: '+1-555-0143',
    familyGroupId: DEFAULT_FAMILY_GROUP_ID,
  }

  const familyUser = users.find((u) => u.role === 'FAMILY') || {
    id: 'b8d2a563-591c-4b62-87b5-0311485cb5cf',
    name: 'David Vance',
    role: 'FAMILY',
    phone: '+1-555-0198',
    familyGroupId: DEFAULT_FAMILY_GROUP_ID,
  }

  // 1-Tap Senior Check-In action
  const handleSeniorCheckIn = async (type, defaultStatus) => {
    setPendingButton(type)
    setErrorMsg(null)
    try {
      const seniorId = seniorUser.id || HARDCODED_SENIOR_USER_ID
      const res = await fetch(`${API_BASE}/api/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: seniorId,
          type,
          status: defaultStatus,
        }),
      })

      if (res.ok) {
        const json = await res.json()
        const now = new Date()
        const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        setCheckInFeedback({
          type,
          title: `${type === 'PILLS' ? 'Pills' : type === 'MEAL' ? 'Meal' : 'Mood'} Check-In Confirmed!`,
          message: `Logged at ${timeStr}. Your family member ${familyUser.name} has been notified.`,
        })

        if (json.data) {
          setCheckIns((prev) => {
            if (prev.some((c) => c.id === json.data.id)) return prev
            return [json.data, ...prev]
          })
        }
      } else {
        const err = await res.json()
        setErrorMsg(err.error || 'Failed to submit check-in')
      }
    } catch {
      setErrorMsg('Failed to connect to backend server')
    } finally {
      setPendingButton(null)
    }
  }

  // Family custom check-in form submission
  const handleCustomCheckInSubmit = async (e) => {
    e.preventDefault()
    if (!customCheckInStatus.trim()) return

    setSubmittingCustomCheckIn(true)
    setErrorMsg(null)
    try {
      const res = await fetch(`${API_BASE}/api/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: seniorUser.id || HARDCODED_SENIOR_USER_ID,
          type: customCheckInType,
          status: customCheckInStatus.trim(),
        }),
      })
      if (res.ok) {
        const json = await res.json()
        if (json.data) {
          setCheckIns((prev) => {
            if (prev.some((c) => c.id === json.data.id)) return prev
            return [json.data, ...prev]
          })
        }
        setCustomCheckInStatus('')
      } else {
        const err = await res.json()
        setErrorMsg(err.error || 'Failed to submit check-in')
      }
    } catch {
      setErrorMsg('Failed to connect to backend server')
    } finally {
      setSubmittingCustomCheckIn(false)
    }
  }

  // Alert triggers
  const handleCreateAlert = async (type) => {
    setSubmittingAlert(true)
    try {
      const res = await fetch(`${API_BASE}/api/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: seniorUser.id || HARDCODED_SENIOR_USER_ID,
          type,
          status: 'ACTIVE',
        }),
      })
      if (res.ok) {
        await loadData()
      } else {
        const err = await res.json()
        setErrorMsg(err.error || 'Failed to trigger alert')
      }
    } catch {
      setErrorMsg('Failed to connect to backend server')
    } finally {
      setSubmittingAlert(false)
    }
  }

  const handleResolveAlert = async (alertId) => {
    try {
      const res = await fetch(`${API_BASE}/api/alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RESOLVED' }),
      })
      if (res.ok) {
        await loadData()
      } else {
        const err = await res.json()
        setErrorMsg(err.error || 'Failed to resolve alert')
      }
    } catch {
      setErrorMsg('Failed to connect to backend server')
    }
  }

  const getTypeBadgeClass = (type) => {
    switch (type) {
      case 'PILLS':
        return 'bg-blue-100 text-blue-800 border-blue-200'
      case 'MEAL':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200'
      case 'MOOD':
        return 'bg-purple-100 text-purple-800 border-purple-200'
      case 'SOS':
        return 'bg-rose-100 text-rose-800 border-rose-200'
      default:
        return 'bg-amber-100 text-amber-800 border-amber-200'
    }
  }

  const getLastCheckInTime = (type) => {
    const item = checkIns.find((c) => c.type === type)
    if (!item) return null
    const date = new Date(item.timestamp)
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      {/* Top Navigation & Status Bar */}
      <header className="bg-white border-b border-slate-200 px-4 sm:px-6 py-3.5 shadow-xs sticky top-0 z-20">
        <div className="max-w-5xl mx-auto flex items-center justify-between gap-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white font-black text-xl shadow-xs">
              CC
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 tracking-tight leading-tight">
                CareCircle
              </h1>
              <p className="text-xs text-slate-500 font-medium">Family Care & Daily Check-Ins</p>
            </div>
          </div>

          {/* Mode Switcher and Indicators */}
          <div className="flex items-center space-x-2 sm:space-x-3">
            <div className="hidden sm:flex items-center space-x-2">
              <span
                className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                  isLive
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
                    : 'bg-slate-100 text-slate-600 border border-slate-300'
                }`}
              >
                <span
                  className={`w-2 h-2 mr-1 rounded-full ${
                    isLive ? 'bg-emerald-500' : 'bg-slate-400'
                  }`}
                />
                {isLive ? 'DB Online' : 'DB Sync'}
              </span>

              <span
                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${
                  socketConnected
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-300'
                    : 'bg-amber-50 text-amber-700 border border-amber-300'
                }`}
              >
                <span
                  className={`w-2 h-2 mr-1.5 rounded-full ${
                    socketConnected ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                  }`}
                />
                {socketConnected ? 'Live Socket Connected' : 'Sync Polling'}
              </span>

              <button
                type="button"
                onClick={loadData}
                disabled={loading}
                className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-2.5 py-1 rounded-md transition-colors cursor-pointer"
              >
                {loading ? 'Refreshing...' : '↻'}
              </button>
            </div>

            <div className="bg-slate-100 p-1 rounded-xl flex items-center">
              <button
                type="button"
                onClick={() => setActiveView('SENIOR')}
                className={`px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-bold rounded-lg transition-all ${
                  activeView === 'SENIOR'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                👵 Senior View
              </button>
              <button
                type="button"
                onClick={() => setActiveView('FAMILY')}
                className={`px-3 sm:px-4 py-1.5 text-xs sm:text-sm font-bold rounded-lg transition-all ${
                  activeView === 'FAMILY'
                    ? 'bg-white text-emerald-800 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                👨‍👩‍👦 Family Dashboard
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Error notification banner */}
        {errorMsg && (
          <div className="mb-6 p-4 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-sm flex justify-between items-center shadow-xs">
            <div className="flex items-center space-x-2">
              <span className="text-rose-600 font-bold">⚠️</span>
              <span>{errorMsg}</span>
            </div>
            <button
              onClick={() => setErrorMsg(null)}
              className="text-rose-500 hover:text-rose-800 font-bold px-2 py-1 text-base cursor-pointer"
            >
              ×
            </button>
          </div>
        )}

        {/* ============================================================== */}
        {/* SENIOR VIEW: 3 BIG ACCESSIBLE BUTTONS (PILLS / MEAL / MOOD)     */}
        {/* ============================================================== */}
        {activeView === 'SENIOR' && (
          <div className="space-y-8">
            {/* Senior Greeting Card */}
            <div className="bg-white rounded-2xl p-6 sm:p-8 border border-slate-200 shadow-xs">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full text-xs font-bold text-emerald-800 mb-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500" />
                    Care Recipient Mode • Eleanor Vance
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                    Good Day, {seniorUser.name}! 🌸
                  </h2>
                  <p className="text-slate-600 text-sm sm:text-base mt-1">
                    Tap any button below to immediately send your daily check-in to your family.
                  </p>
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs sm:text-sm text-slate-600">
                  <div className="font-semibold text-slate-800">Caregiver Connected</div>
                  <div>
                    {familyUser.name} ({familyUser.phone})
                  </div>
                  <div className="text-slate-400 text-xs mt-0.5 font-mono">
                    Group: {seniorUser.familyGroupId}
                  </div>
                </div>
              </div>
            </div>

            {/* Check-In Success Toast */}
            {checkInFeedback && (
              <div className="p-4 sm:p-5 rounded-2xl bg-emerald-50 border-2 border-emerald-400 text-emerald-900 shadow-sm animate-fade-in flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <span className="text-3xl">✅</span>
                  <div>
                    <div className="font-bold text-base sm:text-lg">{checkInFeedback.title}</div>
                    <div className="text-xs sm:text-sm text-emerald-800">
                      {checkInFeedback.message}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setCheckInFeedback(null)}
                  className="text-emerald-700 hover:text-emerald-900 font-bold px-3 py-1 text-sm bg-emerald-100 hover:bg-emerald-200 rounded-lg cursor-pointer transition-colors"
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* 3 BIG BUTTONS: PILLS / MEAL / MOOD */}
            <div>
              <div className="text-xs font-bold tracking-wider text-slate-400 uppercase mb-3">
                Daily Check-In Buttons
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {/* 1. PILLS BUTTON */}
                <button
                  type="button"
                  onClick={() => handleSeniorCheckIn('PILLS', 'Morning medications taken')}
                  disabled={pendingButton === 'PILLS'}
                  className={`w-full text-left p-6 sm:p-7 rounded-2xl border-3 transition-all duration-150 transform active:scale-98 cursor-pointer shadow-sm hover:shadow-md ${
                    pendingButton === 'PILLS'
                      ? 'opacity-70 bg-blue-100 border-blue-500'
                      : 'bg-gradient-to-br from-blue-50 via-white to-blue-50 hover:from-blue-100 hover:to-indigo-50 border-blue-400 hover:border-blue-600'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="text-5xl sm:text-6xl select-none" role="img" aria-label="Pills">
                      💊
                    </span>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-blue-100 text-blue-800 border border-blue-200">
                      {pendingButton === 'PILLS' ? 'Sending...' : '1-Tap'}
                    </span>
                  </div>

                  <div className="mt-4">
                    <h3 className="text-2xl sm:text-3xl font-extrabold text-blue-950 tracking-tight">
                      Pills
                    </h3>
                    <p className="text-sm font-medium text-blue-800 mt-1">Took My Medication</p>
                  </div>

                  <div className="mt-6 pt-3 border-t border-blue-200/70 flex items-center justify-between text-xs text-blue-700">
                    <span>Last taken:</span>
                    <span className="font-bold">
                      {getLastCheckInTime('PILLS') || 'Not yet today'}
                    </span>
                  </div>
                </button>

                {/* 2. MEAL BUTTON */}
                <button
                  type="button"
                  onClick={() => handleSeniorCheckIn('MEAL', 'Finished a healthy meal')}
                  disabled={pendingButton === 'MEAL'}
                  className={`w-full text-left p-6 sm:p-7 rounded-2xl border-3 transition-all duration-150 transform active:scale-98 cursor-pointer shadow-sm hover:shadow-md ${
                    pendingButton === 'MEAL'
                      ? 'opacity-70 bg-emerald-100 border-emerald-500'
                      : 'bg-gradient-to-br from-emerald-50 via-white to-emerald-50 hover:from-emerald-100 hover:to-teal-50 border-emerald-400 hover:border-emerald-600'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="text-5xl sm:text-6xl select-none" role="img" aria-label="Meal">
                      🍲
                    </span>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 border border-emerald-200">
                      {pendingButton === 'MEAL' ? 'Sending...' : '1-Tap'}
                    </span>
                  </div>

                  <div className="mt-4">
                    <h3 className="text-2xl sm:text-3xl font-extrabold text-emerald-950 tracking-tight">
                      Meal
                    </h3>
                    <p className="text-sm font-medium text-emerald-800 mt-1">Ate My Meal</p>
                  </div>

                  <div className="mt-6 pt-3 border-t border-emerald-200/70 flex items-center justify-between text-xs text-emerald-700">
                    <span>Last meal:</span>
                    <span className="font-bold">
                      {getLastCheckInTime('MEAL') || 'Not yet today'}
                    </span>
                  </div>
                </button>

                {/* 3. MOOD BUTTON */}
                <button
                  type="button"
                  onClick={() => handleSeniorCheckIn('MOOD', 'Feeling good and cheerful')}
                  disabled={pendingButton === 'MOOD'}
                  className={`w-full text-left p-6 sm:p-7 rounded-2xl border-3 transition-all duration-150 transform active:scale-98 cursor-pointer shadow-sm hover:shadow-md ${
                    pendingButton === 'MOOD'
                      ? 'opacity-70 bg-purple-100 border-purple-500'
                      : 'bg-gradient-to-br from-purple-50 via-white to-amber-50 hover:from-purple-100 hover:to-pink-50 border-purple-400 hover:border-purple-600'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="text-5xl sm:text-6xl select-none" role="img" aria-label="Mood">
                      😊
                    </span>
                    <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-purple-100 text-purple-800 border border-purple-200">
                      {pendingButton === 'MOOD' ? 'Sending...' : '1-Tap'}
                    </span>
                  </div>

                  <div className="mt-4">
                    <h3 className="text-2xl sm:text-3xl font-extrabold text-purple-950 tracking-tight">
                      Mood
                    </h3>
                    <p className="text-sm font-medium text-purple-800 mt-1">Feeling Good</p>
                  </div>

                  <div className="mt-6 pt-3 border-t border-purple-200/70 flex items-center justify-between text-xs text-purple-700">
                    <span>Last shared:</span>
                    <span className="font-bold">
                      {getLastCheckInTime('MOOD') || 'Not yet today'}
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {/* Emergency Assistance Callout */}
            <div className="bg-rose-50 border-2 border-rose-200 rounded-2xl p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center space-x-4">
                <span className="text-4xl">🚨</span>
                <div>
                  <h4 className="text-lg font-bold text-rose-950">Need Immediate Help?</h4>
                  <p className="text-xs sm:text-sm text-rose-800">
                    Tap the emergency alert button to immediately send an urgent SOS notification to
                    David Vance.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleCreateAlert('SOS')}
                disabled={submittingAlert}
                className="w-full sm:w-auto bg-rose-600 hover:bg-rose-700 text-white font-extrabold text-sm sm:text-base px-6 py-3 rounded-xl shadow-md cursor-pointer transition-colors active:scale-95"
              >
                {submittingAlert ? 'Triggering SOS...' : '🚨 Send SOS Alert'}
              </button>
            </div>

            {/* Live Senior Activity Feed */}
            <div className="bg-white rounded-2xl p-6 sm:p-7 border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">
                  Recent Check-In Activity for {seniorUser.name}
                </h3>
                <span className="text-xs font-semibold text-slate-500">
                  {checkIns.length} logged
                </span>
              </div>

              {checkIns.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <p className="text-2xl mb-1">📋</p>
                  <p className="text-sm font-medium">No check-ins recorded yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {checkIns.slice(0, 6).map((item) => (
                    <div
                      key={item.id}
                      className="p-3.5 bg-slate-50 hover:bg-slate-100/70 border border-slate-200 rounded-xl flex items-center justify-between transition-colors"
                    >
                      <div className="flex items-center space-x-3">
                        <span className="text-2xl">
                          {item.type === 'PILLS' ? '💊' : item.type === 'MEAL' ? '🍲' : '😊'}
                        </span>
                        <div>
                          <div className="flex items-center space-x-2">
                            <span
                              className={`text-xs font-bold px-2 py-0.5 rounded-md border ${getTypeBadgeClass(
                                item.type
                              )}`}
                            >
                              {item.type}
                            </span>
                            <span className="text-sm font-semibold text-slate-800">
                              {item.status}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mt-0.5">
                            {new Date(item.timestamp).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-md border border-emerald-200">
                        Saved to DB
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* FAMILY CAREGIVER DASHBOARD VIEW                                */}
        {/* ============================================================== */}
        {activeView === 'FAMILY' && (
          <div className="space-y-8">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h2 className="text-2xl font-bold text-slate-900">Family Caregiver Dashboard</h2>
                <p className="text-slate-600 text-sm mt-0.5">
                  Shared Family Circle:{' '}
                  <code className="bg-slate-200 text-slate-800 px-2 py-0.5 rounded text-xs font-mono">
                    {seniorUser.familyGroupId}
                  </code>
                </p>
              </div>
              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  onClick={() => handleCreateAlert('SOS')}
                  disabled={submittingAlert}
                  className="bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs px-3.5 py-2 rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  {submittingAlert ? 'Triggering...' : '🚨 Trigger SOS Alert'}
                </button>
                <button
                  type="button"
                  onClick={() => handleCreateAlert('NO_CHECKIN')}
                  disabled={submittingAlert}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-medium text-xs px-3.5 py-2 rounded-lg shadow-xs transition-colors cursor-pointer"
                >
                  ⚠️ Log Missed Check-In
                </button>
              </div>
            </div>

            {/* Member Profile Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-base">
                      EV
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-800">{seniorUser.name}</h3>
                      <span className="text-xs text-slate-500">Senior Care Recipient</span>
                    </div>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-blue-100 text-blue-800">
                    {seniorUser.role}
                  </span>
                </div>
                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  <p>
                    <span className="font-medium text-slate-700">Phone:</span> {seniorUser.phone}
                  </p>
                  <p>
                    <span className="font-medium text-slate-700">User ID:</span>{' '}
                    <span className="font-mono text-xs">{seniorUser.id}</span>
                  </p>
                </div>
              </div>

              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-base">
                      DV
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-800">{familyUser.name}</h3>
                      <span className="text-xs text-slate-500">Primary Family Caregiver</span>
                    </div>
                  </div>
                  <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                    {familyUser.role}
                  </span>
                </div>
                <div className="mt-4 space-y-2 text-sm text-slate-600">
                  <p>
                    <span className="font-medium text-slate-700">Phone:</span> {familyUser.phone}
                  </p>
                  <p>
                    <span className="font-medium text-slate-700">Family Group:</span>{' '}
                    <span className="font-mono text-xs">{familyUser.familyGroupId}</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Check-ins and Alerts grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Check-Ins Column */}
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                  <h3 className="text-lg font-semibold text-slate-800 mb-4">
                    Manual Check-In for {seniorUser.name}
                  </h3>
                  <form onSubmit={handleCustomCheckInSubmit} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Check-In Type
                      </label>
                      <div className="grid grid-cols-3 gap-2">
                        {['PILLS', 'MEAL', 'MOOD'].map((t) => (
                          <button
                            type="button"
                            key={t}
                            onClick={() => setCustomCheckInType(t)}
                            className={`py-1.5 px-3 text-xs font-semibold rounded-lg border transition-colors cursor-pointer ${
                              customCheckInType === t
                                ? 'bg-emerald-600 text-white border-emerald-600'
                                : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'
                            }`}
                          >
                            {t}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <label className="block text-xs font-medium text-slate-700 mb-1">
                        Status / Note
                      </label>
                      <input
                        type="text"
                        value={customCheckInStatus}
                        onChange={(e) => setCustomCheckInStatus(e.target.value)}
                        placeholder="e.g. Took blood pressure pills"
                        className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                        required
                      />
                    </div>

                    <button
                      type="submit"
                      disabled={submittingCustomCheckIn || !customCheckInStatus.trim()}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs py-2 px-4 rounded-lg shadow-xs transition-colors cursor-pointer"
                    >
                      {submittingCustomCheckIn ? 'Saving...' : 'Submit Check-In'}
                    </button>
                  </form>
                </div>

                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                  <h3 className="text-lg font-semibold text-slate-800 mb-4">Recent Check-Ins</h3>
                  {checkIns.length === 0 ? (
                    <p className="text-sm text-slate-500">No check-ins logged yet.</p>
                  ) : (
                    <div className="space-y-3">
                      {checkIns.map((item) => (
                        <div
                          key={item.id}
                          className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between"
                        >
                          <div>
                            <div className="flex items-center space-x-2">
                              <span
                                className={`text-xs font-bold px-2 py-0.5 rounded-sm border ${getTypeBadgeClass(
                                  item.type
                                )}`}
                              >
                                {item.type}
                              </span>
                              <span className="text-sm font-medium text-slate-800">
                                {item.status}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400 mt-1">
                              {new Date(item.timestamp).toLocaleString()}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Alerts Column */}
              <div className="space-y-6">
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-xs">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold text-slate-800">Alert Center</h3>
                    <span className="text-xs font-semibold text-slate-500">
                      {alerts.filter((a) => a.status === 'ACTIVE').length} Active
                    </span>
                  </div>

                  {alerts.length === 0 ? (
                    <p className="text-sm text-slate-500">No alerts on record.</p>
                  ) : (
                    <div className="space-y-3">
                      {alerts.map((alert) => (
                        <div
                          key={alert.id}
                          className={`p-4 border rounded-xl flex items-center justify-between ${
                            alert.status === 'ACTIVE'
                              ? 'bg-rose-50 border-rose-200'
                              : 'bg-slate-50 border-slate-200'
                          }`}
                        >
                          <div>
                            <div className="flex items-center space-x-2">
                              <span
                                className={`text-xs font-bold px-2 py-0.5 rounded-sm border ${getTypeBadgeClass(
                                  alert.type
                                )}`}
                              >
                                {alert.type}
                              </span>
                              <span
                                className={`text-xs font-bold px-2 py-0.5 rounded-sm ${
                                  alert.status === 'ACTIVE'
                                    ? 'bg-rose-200 text-rose-800 animate-pulse'
                                    : 'bg-slate-200 text-slate-700'
                                }`}
                              >
                                {alert.status}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-1">
                              Logged: {new Date(alert.timestamp).toLocaleString()}
                            </p>
                          </div>

                          {alert.status === 'ACTIVE' && (
                            <button
                              type="button"
                              onClick={() => handleResolveAlert(alert.id)}
                              className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-medium text-xs px-3 py-1.5 rounded-lg shadow-2xs transition-colors cursor-pointer"
                            >
                              Resolve
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-emerald-50 p-6 rounded-2xl border border-emerald-200">
                  <h4 className="text-sm font-semibold text-emerald-900 mb-2">
                    Prisma Studio & Socket.io Live Status
                  </h4>
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    Database seeded with Eleanor Vance (Senior) and David Vance (Family) sharing family
                    group <code className="font-mono font-semibold">fam_group_carecircle_101</code>.
                    Any check-in submitted via the Senior view or API broadcasts in real-time over
                    Socket.io room <code className="font-mono font-semibold">fam_group_carecircle_101</code>.
                  </p>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
