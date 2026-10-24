import { useState, useEffect, useCallback } from 'react'

const API_BASE = ''

export default function App() {
  const [users, setUsers] = useState([])
  const [checkIns, setCheckIns] = useState([])
  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [isLive, setIsLive] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)

  // Quick form states
  const [checkInType, setCheckInType] = useState('PILLS')
  const [checkInStatus, setCheckInStatus] = useState('Morning medication taken')
  const [submittingCheckIn, setSubmittingCheckIn] = useState(false)
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

  useEffect(() => {
    let ignore = false
    async function init() {
      try {
        const [uRes, cRes, aRes] = await Promise.all([
          fetch(`${API_BASE}/api/users`).then((r) => (r.ok ? r.json() : null)),
          fetch(`${API_BASE}/api/checkins`).then((r) => (r.ok ? r.json() : null)),
          fetch(`${API_BASE}/api/alerts`).then((r) => (r.ok ? r.json() : null)),
        ])
        if (ignore) return
        if (uRes && uRes.success) {
          setUsers(uRes.data || [])
          setIsLive(true)
        } else {
          setIsLive(false)
        }
        if (cRes && cRes.success) setCheckIns(cRes.data || [])
        if (aRes && aRes.success) setAlerts(aRes.data || [])
      } catch {
        if (!ignore) setIsLive(false)
      } finally {
        if (!ignore) setLoading(false)
      }
    }
    init()
    return () => {
      ignore = true
    }
  }, [])

  const seniorUser = users.find((u) => u.role === 'SENIOR') || {
    id: 'preview-senior',
    name: 'Eleanor Vance',
    role: 'SENIOR',
    phone: '+1-555-0143',
    familyGroupId: 'fam_group_carecircle_101',
  }

  const familyUser = users.find((u) => u.role === 'FAMILY') || {
    id: 'preview-family',
    name: 'David Vance',
    role: 'FAMILY',
    phone: '+1-555-0198',
    familyGroupId: 'fam_group_carecircle_101',
  }

  const handleCreateCheckIn = async (e) => {
    e.preventDefault()
    if (!checkInStatus.trim()) return

    setSubmittingCheckIn(true)
    try {
      const res = await fetch(`${API_BASE}/api/checkins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: seniorUser.id,
          type: checkInType,
          status: checkInStatus,
        }),
      })
      if (res.ok) {
        await loadData()
        setCheckInStatus('')
      } else {
        const err = await res.json()
        setErrorMsg(err.error || 'Failed to submit check-in')
      }
    } catch {
      setErrorMsg('Failed to connect to backend server')
    } finally {
      setSubmittingCheckIn(false)
    }
  }

  const handleCreateAlert = async (type) => {
    setSubmittingAlert(true)
    try {
      const res = await fetch(`${API_BASE}/api/alerts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: seniorUser.id,
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
        return 'bg-blue-100 text-blue-800'
      case 'MEAL':
        return 'bg-emerald-100 text-emerald-800'
      case 'MOOD':
        return 'bg-purple-100 text-purple-800'
      case 'SOS':
        return 'bg-rose-100 text-rose-800'
      default:
        return 'bg-amber-100 text-amber-800'
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans">
      <header className="bg-white border-b border-slate-200 px-6 py-4 shadow-xs">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center text-white font-bold text-lg shadow-xs">
              CC
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-900 leading-tight">CareCircle</h1>
              <p className="text-xs text-slate-500">Elderly Care & Family Check-In System</p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            <span
              className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                isLive
                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                  : 'bg-amber-100 text-amber-800 border border-amber-300'
              }`}
            >
              <span
                className={`w-2 h-2 mr-1.5 rounded-full ${
                  isLive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
                }`}
              />
              {isLive ? 'Database Connected' : 'Offline / Standalone Preview'}
            </span>
            <button
              onClick={loadData}
              disabled={loading}
              className="text-xs bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium px-3 py-1 rounded-md transition-colors"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {errorMsg && (
          <div className="mb-6 p-4 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-sm flex justify-between items-center">
            <span>{errorMsg}</span>
            <button
              onClick={() => setErrorMsg(null)}
              className="text-rose-500 hover:text-rose-800 font-bold ml-4"
            >
              ×
            </button>
          </div>
        )}

        <div className="mb-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">Care Circle Family Group</h2>
            <p className="text-slate-600 mt-1">
              Shared Group ID:{' '}
              <code className="bg-slate-200 text-slate-800 px-2 py-0.5 rounded text-xs font-mono">
                {seniorUser.familyGroupId}
              </code>
            </p>
          </div>
          <div className="flex items-center space-x-2">
            <button
              onClick={() => handleCreateAlert('SOS')}
              disabled={submittingAlert}
              className="bg-rose-600 hover:bg-rose-700 text-white font-medium text-xs px-4 py-2 rounded-lg shadow-xs transition-colors"
            >
              {submittingAlert ? 'Triggering...' : '🚨 Trigger SOS Alert'}
            </button>
            <button
              onClick={() => handleCreateAlert('NO_CHECKIN')}
              disabled={submittingAlert}
              className="bg-amber-500 hover:bg-amber-600 text-white font-medium text-xs px-3 py-2 rounded-lg shadow-xs transition-colors"
            >
              ⚠️ Log Missed Check-In
            </button>
          </div>
        </div>

        {/* Member cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm">
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
                <span className="font-medium text-slate-700">Family Group:</span>{' '}
                <span className="font-mono text-xs">{seniorUser.familyGroupId}</span>
              </p>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-3">
                <div className="w-9 h-9 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm">
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
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
              <h3 className="text-lg font-semibold text-slate-800 mb-4">Log New Check-In</h3>
              <form onSubmit={handleCreateCheckIn} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Check-In Type
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {['PILLS', 'MEAL', 'MOOD'].map((t) => (
                      <button
                        type="button"
                        key={t}
                        onClick={() => setCheckInType(t)}
                        className={`py-1.5 px-3 text-xs font-semibold rounded-lg border transition-colors ${
                          checkInType === t
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
                    value={checkInStatus}
                    onChange={(e) => setCheckInStatus(e.target.value)}
                    placeholder="e.g. Took blood pressure pills"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={submittingCheckIn || !checkInStatus.trim()}
                  className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs py-2 px-4 rounded-lg shadow-xs transition-colors"
                >
                  {submittingCheckIn ? 'Saving...' : 'Submit Check-In'}
                </button>
              </form>
            </div>

            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
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
                            className={`text-xs font-bold px-2 py-0.5 rounded-sm ${getTypeBadgeClass(
                              item.type
                            )}`}
                          >
                            {item.type}
                          </span>
                          <span className="text-sm font-medium text-slate-800">{item.status}</span>
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
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-xs">
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
                            className={`text-xs font-bold px-2 py-0.5 rounded-sm ${getTypeBadgeClass(
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
                          onClick={() => handleResolveAlert(alert.id)}
                          className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-medium text-xs px-3 py-1.5 rounded-lg shadow-2xs transition-colors"
                        >
                          Resolve
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="bg-emerald-50 p-6 rounded-xl border border-emerald-200">
              <h4 className="text-sm font-semibold text-emerald-900 mb-2">Prisma Studio Status</h4>
              <p className="text-xs text-emerald-800 leading-relaxed">
                Database seeded with Eleanor Vance (Senior) and David Vance (Family) sharing family
                group <code className="font-mono font-semibold">fam_group_carecircle_101</code>. Run{' '}
                <code className="font-mono bg-emerald-100 px-1 py-0.5 rounded">
                  npm run prisma:studio
                </code>{' '}
                to visually inspect all User, CheckIn, and Alert records in the browser.
              </p>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
