import { useState, useEffect, useCallback, useRef } from 'react'
import { io } from 'socket.io-client'
import MoodTrendView from './components/MoodTrendView.jsx'

const API_BASE = ''
const HARDCODED_SENIOR_USER_ID = 'ffd75d01-03e9-4138-abd1-b095ac5ba212'
const DEFAULT_FAMILY_GROUP_ID = 'fam_group_carecircle_101'

function formatCheckInTime(timestamp) {
  if (!timestamp) return 'No check-in yet'
  const date = new Date(timestamp)
  if (isNaN(date.getTime())) return 'Invalid date'
  const isToday = new Date().toDateString() === date.toDateString()
  const timeStr = date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  return isToday ? `Today at ${timeStr}` : `${date.toLocaleDateString()} at ${timeStr}`
}

function getRelativeTime(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  if (isNaN(date.getTime())) return ''
  const diffSec = Math.floor((Date.now() - date.getTime()) / 1000)
  if (diffSec < 5) return 'Just now'
  if (diffSec < 60) return `${diffSec}s ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

function getInitials(name, fallback = 'CC') {
  if (!name) return fallback
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return fallback
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

export default function App() {
  const [activeView, setActiveView] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search)
      const v = p.get('view')?.toUpperCase()
      if (v === 'FAMILY' || v === 'SENIOR') return v
    }
    return 'SENIOR'
  })

  const [activeFamilyGroupId] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search)
      const g = p.get('familyGroupId')?.trim()
      if (g) return g
    }
    return DEFAULT_FAMILY_GROUP_ID
  })

  const [nowTimestamp, setNowTimestamp] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNowTimestamp(Date.now()), 30000)
    return () => clearInterval(timer)
  }, [])

  const [selectedSeniorId, setSelectedSeniorId] = useState(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search)
      const s = p.get('seniorId') || p.get('userId')
      if (s) return s.trim()
    }
    return HARDCODED_SENIOR_USER_ID
  })

  const [users, setUsers] = useState([])
  const usersRef = useRef(users)
  useEffect(() => {
    usersRef.current = users
  }, [users])
  const [dashboardSeniors, setDashboardSeniors] = useState([])
  const [checkIns, setCheckIns] = useState([])
  const [moodCheckIns, setMoodCheckIns] = useState([])
  const [moodLoading, setMoodLoading] = useState(true)
  const [alerts, setAlerts] = useState([])
  const [resolvingAlertId, setResolvingAlertId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [isLive, setIsLive] = useState(false)
  const [socketConnected, setSocketConnected] = useState(false)
  const [errorMsg, setErrorMsg] = useState(null)
  const [lastLiveEvent, setLastLiveEvent] = useState(null)

  // Senior view quick-feedback state
  const [pendingButton, setPendingButton] = useState(null) // 'PILLS' | 'MEAL' | 'MOOD' | null
  const [checkInFeedback, setCheckInFeedback] = useState(null)
  const [showSosConfirmDialog, setShowSosConfirmDialog] = useState(false)

  // Family dashboard form states
  const [customCheckInType, setCustomCheckInType] = useState('PILLS')
  const [customCheckInStatus, setCustomCheckInStatus] = useState('Morning medication taken')
  const [customSeniorId, setCustomSeniorId] = useState('')
  const [submittingCustomCheckIn, setSubmittingCustomCheckIn] = useState(false)
  const [submittingAlert, setSubmittingAlert] = useState(false)

  const handleViewSelect = (view) => {
    setActiveView(view)
    if (typeof window !== 'undefined' && window.history?.replaceState) {
      const url = new URL(window.location.href)
      url.searchParams.set('view', view.toLowerCase())
      window.history.replaceState({}, '', url.toString())
    }
  }

  const loadData = useCallback(async () => {
    try {
      const [dashRes, uRes, aRes, mRes] = await Promise.all([
        fetch(`${API_BASE}/api/dashboard/${activeFamilyGroupId}`).then((r) =>
          r.ok ? r.json() : null
        ),
        fetch(`${API_BASE}/api/users?familyGroupId=${activeFamilyGroupId}`).then((r) =>
          r.ok ? r.json() : null
        ),
        fetch(
          `${API_BASE}/api/alerts?familyGroupId=${encodeURIComponent(activeFamilyGroupId)}`
        ).then((r) => (r.ok ? r.json() : null)),
        fetch(
          `${API_BASE}/api/checkins?familyGroupId=${encodeURIComponent(activeFamilyGroupId)}&type=MOOD&limit=7`
        ).then((r) => (r.ok ? r.json() : null)),
      ])

      if (dashRes && dashRes.success) {
        setDashboardSeniors(dashRes.data?.seniors || [])
        setCheckIns(dashRes.data?.recentCheckIns || [])
        setIsLive(true)
      } else {
        setIsLive(false)
      }

      if (mRes && mRes.success) {
        setMoodCheckIns(mRes.data || [])
      }

      if (uRes && uRes.success) {
        setUsers(uRes.data || [])
      }
      if (aRes && aRes.success) {
        setAlerts(aRes.data || [])
      }
    } catch {
      setIsLive(false)
    } finally {
      setLoading(false)
      setMoodLoading(false)
    }
  }, [activeFamilyGroupId])

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
      query: { familyGroupId: activeFamilyGroupId },
      auth: { familyGroupId: activeFamilyGroupId },
      transports: ['websocket', 'polling'],
    })

    socket.on('connect', () => {
      setSocketConnected(true)
      socket.emit('join:family', activeFamilyGroupId)
      socket.emit('join', activeFamilyGroupId)
      loadData()
    })

    socket.on('disconnect', () => {
      setSocketConnected(false)
    })

    socket.on('checkin:new', (newCheckIn) => {
      // Ignore check-ins for different family groups
      if (
        newCheckIn.user?.familyGroupId &&
        newCheckIn.user.familyGroupId !== activeFamilyGroupId
      ) {
        return
      }

      // 1. Live list of check-ins (prepend new check-in without page refresh)
      setCheckIns((prev) => {
        if (prev.some((c) => c.id === newCheckIn.id)) return prev
        return [newCheckIn, ...prev]
      })

      // 1b. If MOOD check-in, update mood trend state (keep last 7)
      if (newCheckIn.type === 'MOOD') {
        setMoodCheckIns((prev) => {
          if (prev.some((m) => m.id === newCheckIn.id)) return prev
          return [newCheckIn, ...prev].slice(0, 7)
        })
      }

      // 2. Status card (update only the matching senior's status to GREEN)
      setDashboardSeniors((prevSeniors) => {
        const targetId = newCheckIn.userId
        const seniorExists = prevSeniors.some((s) => s.id === targetId)

        if (!seniorExists && newCheckIn.user?.role === 'SENIOR') {
          return [
            ...prevSeniors,
            {
              id: targetId,
              name: newCheckIn.user?.name || 'Senior Member',
              role: 'SENIOR',
              phone: newCheckIn.user?.phone || '+1-555-0143',
              familyGroupId: newCheckIn.user?.familyGroupId || activeFamilyGroupId,
              status: 'GREEN',
              statusColor: 'green',
              latestCheckIn: newCheckIn,
              lastCheckInTime: newCheckIn.timestamp,
              isCheckedInRecently: true,
              activeAlerts: [],
              hasActiveAlerts: false,
              recentCheckIns: [newCheckIn],
            },
          ]
        }

        return prevSeniors.map((senior) => {
          if (senior.id === targetId) {
            const hasAlerts = (senior.activeAlerts || []).some((a) => a.status === 'ACTIVE')
            const isSafe = !hasAlerts
            return {
              ...senior,
              status: isSafe ? 'GREEN' : 'RED',
              statusColor: isSafe ? 'green' : 'red',
              latestCheckIn: newCheckIn,
              lastCheckInTime: newCheckIn.timestamp,
              isCheckedInRecently: true,
              recentCheckIns: [newCheckIn, ...(senior.recentCheckIns || [])].slice(0, 5),
            }
          }
          return senior
        })
      })

      // 3. Record live update event for UI flash / indicator
      setLastLiveEvent({
        id: newCheckIn.id,
        type: newCheckIn.type,
        status: newCheckIn.status,
        seniorName: newCheckIn.user?.name || 'Senior',
        timestamp: newCheckIn.timestamp || new Date().toISOString(),
      })
    })

    const triggerAudioVibrationAlert = () => {
      try {
        if (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) {
          const AudioCtx = window.AudioContext || window.webkitAudioContext
          const ctx = new AudioCtx()
          if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {})
          }
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.type = 'sawtooth'
          osc.frequency.setValueAtTime(880, ctx.currentTime)
          osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3)
          gain.gain.setValueAtTime(0.3, ctx.currentTime)
          gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.3)
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.start()
          osc.stop(ctx.currentTime + 0.3)
        }
      } catch {}
      try {
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
          navigator.vibrate([200, 100, 200])
        }
      } catch {}
    }

    const handleSosAlert = (sosAlert) => {
      const alertFamilyGroupId =
        sosAlert.user?.familyGroupId ||
        usersRef.current.find((u) => u.id === sosAlert.userId)?.familyGroupId
      if (alertFamilyGroupId && alertFamilyGroupId !== activeFamilyGroupId) {
        return
      }

      setAlerts((prev) => {
        if (prev.some((a) => a.id === sosAlert.id)) {
          return prev.map((a) => (a.id === sosAlert.id ? sosAlert : a))
        }
        return [sosAlert, ...prev]
      })

      setDashboardSeniors((prevSeniors) => {
        const seniorExists = prevSeniors.some((s) => s.id === sosAlert.userId)
        if (!seniorExists && (sosAlert.user || usersRef.current.find((u) => u.id === sosAlert.userId))) {
          const uObj = sosAlert.user || usersRef.current.find((u) => u.id === sosAlert.userId)
          return [
            ...prevSeniors,
            {
              id: sosAlert.userId,
              name: uObj.name || 'Senior Member',
              role: uObj.role || 'SENIOR',
              phone: uObj.phone || '+1-555-0143',
              familyGroupId: uObj.familyGroupId || activeFamilyGroupId,
              status: 'RED',
              statusColor: 'red',
              hasActiveAlerts: true,
              activeAlerts: [sosAlert],
              latestCheckIn: null,
              lastCheckInTime: null,
              isCheckedInRecently: false,
              recentCheckIns: [],
            },
          ]
        }

        return prevSeniors.map((senior) => {
          if (senior.id === sosAlert.userId) {
            const existing = senior.activeAlerts || []
            const updated = existing.some((a) => a.id === sosAlert.id)
              ? existing.map((a) => (a.id === sosAlert.id ? sosAlert : a))
              : [sosAlert, ...existing]
            return {
              ...senior,
              status: 'RED',
              statusColor: 'red',
              hasActiveAlerts: true,
              activeAlerts: updated,
            }
          }
          return senior
        })
      })

      triggerAudioVibrationAlert()

      setLastLiveEvent({
        id: sosAlert.id,
        type: 'ALERT_SOS',
        status: 'EMERGENCY SOS ALERT',
        seniorName: sosAlert.user?.name || 'Senior',
        timestamp: sosAlert.timestamp || new Date().toISOString(),
      })
    }

    socket.on('alert:sos', handleSosAlert)

    socket.on('alert:new', (newAlert) => {
      // Ignore alerts for different family groups
      const alertFamilyGroupId =
        newAlert.user?.familyGroupId ||
        usersRef.current.find((u) => u.id === newAlert.userId)?.familyGroupId
      if (alertFamilyGroupId && alertFamilyGroupId !== activeFamilyGroupId) {
        return
      }

      // Add or update alert in alerts list
      setAlerts((prev) => {
        if (prev.some((a) => a.id === newAlert.id)) {
          return prev.map((a) => (a.id === newAlert.id ? newAlert : a))
        }
        return [newAlert, ...prev]
      })

      // Update senior's status to RED and activeAlerts
      setDashboardSeniors((prevSeniors) =>
        prevSeniors.map((senior) => {
          if (senior.id === newAlert.userId) {
            const existing = senior.activeAlerts || []
            const updated = existing.some((a) => a.id === newAlert.id)
              ? existing.map((a) => (a.id === newAlert.id ? newAlert : a))
              : [newAlert, ...existing]
            return {
              ...senior,
              status: 'RED',
              statusColor: 'red',
              hasActiveAlerts: true,
              activeAlerts: updated,
            }
          }
          return senior
        })
      )

      if (newAlert.type === 'SOS') {
        triggerAudioVibrationAlert()
      }

      // Live event notification
      setLastLiveEvent({
        id: newAlert.id,
        type: `ALERT_${newAlert.type}`,
        status:
          newAlert.type === 'NO_CHECKIN'
            ? 'No Check-In'
            : newAlert.type === 'SOS'
            ? 'EMERGENCY SOS ALERT'
            : newAlert.type,
        seniorName: newAlert.user?.name || 'Senior',
        timestamp: newAlert.timestamp || new Date().toISOString(),
      })
    })

    const handleAlertUpdated = (updatedAlert) => {
      setAlerts((prev) => {
        const existing = prev.find((a) => a.id === updatedAlert.id)
        if (existing && existing.status === updatedAlert.status) {
          return prev
        }
        return prev.map((a) => (a.id === updatedAlert.id ? { ...a, ...updatedAlert } : a))
      })
      if (updatedAlert.status === 'RESOLVED') {
        setDashboardSeniors((prevSeniors) =>
          prevSeniors.map((senior) => {
            if (senior.id === updatedAlert.userId) {
              const remaining = (senior.activeAlerts || []).filter(
                (a) => a.id !== updatedAlert.id
              )
              const hasAlerts = remaining.length > 0
              const isSafe = senior.isCheckedInRecently && !hasAlerts
              return {
                ...senior,
                activeAlerts: remaining,
                hasActiveAlerts: hasAlerts,
                status: isSafe ? 'GREEN' : 'RED',
                statusColor: isSafe ? 'green' : 'red',
              }
            }
            return senior
          })
        )
      }
    }

    socket.on('alert:resolved', handleAlertUpdated)
    socket.on('alert:updated', handleAlertUpdated)

    return () => {
      socket.disconnect()
    }
  }, [activeFamilyGroupId, loadData])

  // Auto-dismiss feedback toast after 6 seconds
  useEffect(() => {
    if (!checkInFeedback) return
    const timer = setTimeout(() => {
      setCheckInFeedback(null)
    }, 6000)
    return () => clearTimeout(timer)
  }, [checkInFeedback])

  // Auto-dismiss live event toast after 6 seconds
  useEffect(() => {
    if (!lastLiveEvent) return
    const timer = setTimeout(() => {
      setLastLiveEvent(null)
    }, 6000)
    return () => clearTimeout(timer)
  }, [lastLiveEvent])

  // Dismiss SOS confirm dialog on Escape key
  useEffect(() => {
    if (!showSosConfirmDialog) return
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && !submittingAlert) {
        setShowSosConfirmDialog(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [showSosConfirmDialog, submittingAlert])

  // Resolved user models (using seeded data or fallback)
  const seniorFromDashboard =
    dashboardSeniors.find((s) => s.id === selectedSeniorId) ||
    dashboardSeniors.find((s) => s.id === HARDCODED_SENIOR_USER_ID) ||
    dashboardSeniors[0]
  const seniorFromUsers =
    users.find((u) => u.id === selectedSeniorId && u.role === 'SENIOR') ||
    users.find((u) => u.role === 'SENIOR')
  const seniorUser = seniorFromDashboard || seniorFromUsers || {
    id: selectedSeniorId || HARDCODED_SENIOR_USER_ID,
    name: 'Eleanor Vance',
    role: 'SENIOR',
    phone: '+1-555-0143',
    familyGroupId: activeFamilyGroupId,
    status: 'RED',
    statusColor: 'red',
  }

  const familyUser = users.find((u) => u.role === 'FAMILY') || {
    id: 'b8d2a563-591c-4b62-87b5-0311485cb5cf',
    name: 'David Vance',
    role: 'FAMILY',
    phone: '+1-555-0198',
    familyGroupId: activeFamilyGroupId,
  }

  // 1-Tap Senior Check-In action
  const handleSeniorCheckIn = async (type, defaultStatus) => {
    if (pendingButton) return // Prevent rapid double-tap / concurrent submissions
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
          if (type === 'MOOD') {
            setMoodCheckIns((prev) => {
              if (prev.some((m) => m.id === json.data.id)) return prev
              return [json.data, ...prev].slice(0, 7)
            })
          }
          setDashboardSeniors((prev) => {
            if (!prev || prev.length === 0) {
              return [
                {
                  id: json.data.userId,
                  name: json.data.user?.name || seniorUser.name,
                  role: 'SENIOR',
                  phone: seniorUser.phone,
                  familyGroupId: activeFamilyGroupId,
                  status: 'GREEN',
                  statusColor: 'green',
                  latestCheckIn: json.data,
                  lastCheckInTime: json.data.timestamp,
                  isCheckedInRecently: true,
                },
              ]
            }
            return prev.map((s) => {
              if (s.id === seniorId) {
                const hasAlerts = (s.activeAlerts || []).some((a) => a.status === 'ACTIVE')
                const isSafe = !hasAlerts
                return {
                  ...s,
                  status: isSafe ? 'GREEN' : 'RED',
                  statusColor: isSafe ? 'green' : 'red',
                  latestCheckIn: json.data,
                  lastCheckInTime: json.data.timestamp,
                  isCheckedInRecently: true,
                  recentCheckIns: [json.data, ...(s.recentCheckIns || [])].slice(0, 5),
                }
              }
              return s
            })
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

    const targetSeniorId = customSeniorId || seniorUser.id || HARDCODED_SENIOR_USER_ID
    setSubmittingCustomCheckIn(true)
    setErrorMsg(null)
    try {
      const res = await fetch(`${API_BASE}/api/checkin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: targetSeniorId,
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
          if (customCheckInType === 'MOOD') {
            setMoodCheckIns((prev) => {
              if (prev.some((m) => m.id === json.data.id)) return prev
              return [json.data, ...prev].slice(0, 7)
            })
          }
          setDashboardSeniors((prev) =>
            prev.map((s) => {
              if (s.id === targetSeniorId) {
                const hasAlerts = (s.activeAlerts || []).some((a) => a.status === 'ACTIVE')
                const isSafe = !hasAlerts
                return {
                  ...s,
                  status: isSafe ? 'GREEN' : 'RED',
                  statusColor: isSafe ? 'green' : 'red',
                  latestCheckIn: json.data,
                  lastCheckInTime: json.data.timestamp,
                  isCheckedInRecently: true,
                  recentCheckIns: [json.data, ...(s.recentCheckIns || [])].slice(0, 5),
                }
              }
              return s
            })
          )
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
  const handleTriggerSos = async () => {
    if (submittingAlert) return
    setSubmittingAlert(true)
    setErrorMsg(null)
    try {
      const seniorId = seniorUser.id || HARDCODED_SENIOR_USER_ID
      const res = await fetch(`${API_BASE}/api/sos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: seniorId,
        }),
      })

      if (res.ok) {
        setShowSosConfirmDialog(false)
        const json = await res.json()
        const now = new Date()
        const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
        setCheckInFeedback({
          type: 'SOS',
          title: '🚨 Emergency SOS Alert Sent!',
          message: `Logged at ${timeStr}. Your family member ${familyUser.name} (${familyUser.phone}) has been notified immediately.`,
        })

        if (json.data) {
          setAlerts((prev) => {
            if (prev.some((a) => a.id === json.data.id)) return prev
            return [json.data, ...prev]
          })
          setDashboardSeniors((prev) => {
            const exists = prev.some((s) => s.id === seniorId)
            if (!exists) {
              return [
                ...prev,
                {
                  id: seniorId,
                  name: json.data.user?.name || seniorUser.name,
                  role: 'SENIOR',
                  phone: json.data.user?.phone || seniorUser.phone,
                  familyGroupId: activeFamilyGroupId,
                  status: 'RED',
                  statusColor: 'red',
                  hasActiveAlerts: true,
                  activeAlerts: [json.data],
                  latestCheckIn: null,
                  lastCheckInTime: null,
                  isCheckedInRecently: false,
                  recentCheckIns: [],
                },
              ]
            }
            return prev.map((s) =>
              s.id === seniorId
                ? {
                    ...s,
                    status: 'RED',
                    statusColor: 'red',
                    hasActiveAlerts: true,
                    activeAlerts: [json.data, ...(s.activeAlerts || []).filter((a) => a.id !== json.data.id)],
                  }
                : s
            )
          })
        }
      } else {
        const err = await res.json()
        setErrorMsg(err.error || 'Failed to trigger SOS alert')
      }
    } catch {
      setErrorMsg('Failed to connect to backend server')
    } finally {
      setSubmittingAlert(false)
    }
  }

  const handleCreateAlert = async (type) => {
    if (type === 'SOS') {
      return handleTriggerSos()
    }
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
    if (!alertId) return
    setResolvingAlertId(alertId)
    setErrorMsg(null)
    try {
      const res = await fetch(`${API_BASE}/api/alerts/${alertId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RESOLVED' }),
      })
      if (res.ok) {
        setAlerts((prev) =>
          prev.map((a) => (a.id === alertId ? { ...a, status: 'RESOLVED' } : a))
        )
        setDashboardSeniors((prevSeniors) =>
          prevSeniors.map((senior) => {
            const remaining = (senior.activeAlerts || []).filter((a) => a.id !== alertId)
            const hasAlerts = remaining.length > 0
            const isSafe = senior.isCheckedInRecently && !hasAlerts
            return {
              ...senior,
              activeAlerts: remaining,
              hasActiveAlerts: hasAlerts,
              status: isSafe ? 'GREEN' : 'RED',
              statusColor: isSafe ? 'green' : 'red',
            }
          })
        )
        await loadData()
      } else {
        const err = await res.json()
        setErrorMsg(err.error || 'Failed to resolve alert')
      }
    } catch {
      setErrorMsg('Failed to connect to backend server')
    } finally {
      setResolvingAlertId(null)
    }
  }

  const activeSosAlerts = alerts.filter((a) => {
    if (a.type !== 'SOS' || a.status !== 'ACTIVE') return false
    const alertFamilyGroupId =
      a.user?.familyGroupId ||
      users.find((u) => u.id === a.userId)?.familyGroupId ||
      dashboardSeniors.find((s) => s.id === a.userId)?.familyGroupId
    return !alertFamilyGroupId || alertFamilyGroupId === activeFamilyGroupId
  })

  const activeNoCheckInAlerts = alerts.filter((a) => {
    if (a.type !== 'NO_CHECKIN' || a.status !== 'ACTIVE') return false
    const alertFamilyGroupId =
      a.user?.familyGroupId ||
      users.find((u) => u.id === a.userId)?.familyGroupId ||
      dashboardSeniors.find((s) => s.id === a.userId)?.familyGroupId
    return !alertFamilyGroupId || alertFamilyGroupId === activeFamilyGroupId
  })

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

  const seniorCheckIns = checkIns.filter((c) => c.userId === seniorUser.id)

  const getLastCheckInTime = (type) => {
    const item = seniorCheckIns.find((c) => c.type === type)
    if (!item) return null
    const date = new Date(item.timestamp)
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }

  const isRecentlyCheckedIn = (ts) => {
    if (!ts) return false
    const t = new Date(ts).getTime()
    return !isNaN(t) && nowTimestamp - t <= 24 * 60 * 60 * 1000
  }

  const effectiveSeniors =
    dashboardSeniors.length > 0
      ? dashboardSeniors
      : [
          {
            ...seniorUser,
            latestCheckIn: seniorCheckIns[0] || null,
            lastCheckInTime: seniorCheckIns[0]?.timestamp || null,
            status: isRecentlyCheckedIn(seniorCheckIns[0]?.timestamp) ? 'GREEN' : 'RED',
            statusColor: isRecentlyCheckedIn(seniorCheckIns[0]?.timestamp) ? 'green' : 'red',
            isCheckedInRecently: isRecentlyCheckedIn(seniorCheckIns[0]?.timestamp),
            recentCheckIns: seniorCheckIns,
          },
        ]

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 font-sans overflow-x-hidden">
      {/* Top Navigation & Status Bar */}
      <header className="bg-white border-b border-slate-200 px-3.5 sm:px-6 py-2.5 sm:py-3.5 shadow-xs sticky top-0 z-20">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 sm:gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2.5 sm:space-x-3">
              <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-emerald-600 flex items-center justify-center text-white font-black text-lg sm:text-xl shadow-xs">
                CC
              </div>
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-slate-900 tracking-tight leading-tight">
                  CareCircle
                </h1>
                <p className="text-[11px] sm:text-xs text-slate-500 font-medium">Family Care & Daily Check-Ins</p>
              </div>
            </div>

            {/* Mobile Online status badge */}
            <div className="flex sm:hidden items-center space-x-1.5 text-xs bg-slate-100 px-2 py-1 rounded-full border border-slate-200">
              <span className={`w-2 h-2 rounded-full ${isLive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
              <span className="font-bold text-slate-700 text-[11px]">{isLive ? 'Live' : 'Syncing'}</span>
            </div>
          </div>

          {/* Mode Switcher and Indicators */}
          <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
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

            <div className="bg-slate-200/80 p-1 rounded-2xl flex items-center shadow-inner border border-slate-300 relative w-full sm:w-auto grid grid-cols-2 sm:flex">
              <button
                type="button"
                onClick={() => handleViewSelect('SENIOR')}
                className={`min-h-[48px] px-3 sm:px-5 py-2 text-xs sm:text-sm font-black rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 tactile-button ${
                  activeView === 'SENIOR'
                    ? 'bg-white text-emerald-950 shadow-md border border-emerald-300 scale-[1.02]'
                    : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                <span className="text-base">👵</span>
                <span>Senior View</span>
              </button>
              <button
                type="button"
                onClick={() => handleViewSelect('FAMILY')}
                className={`min-h-[48px] px-3 sm:px-5 py-2 text-xs sm:text-sm font-black rounded-xl transition-all duration-200 cursor-pointer flex items-center justify-center gap-1.5 tactile-button ${
                  activeView === 'FAMILY'
                    ? 'bg-white text-emerald-950 shadow-md border border-emerald-300 scale-[1.02]'
                    : 'text-slate-700 hover:text-slate-950'
                }`}
              >
                <span className="text-base">👨‍👩‍👦</span>
                <span>Family Dashboard</span>
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
                    Care Recipient Mode • {seniorUser.name}
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                    Good Day, {seniorUser.name}! 🌸
                  </h2>
                  <p className="text-slate-600 text-sm sm:text-base mt-1">
                    Tap any button below to immediately send your daily check-in to your family.
                  </p>

                  {/* Senior Switcher if multiple seniors exist */}
                  {effectiveSeniors.length > 1 && (
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-slate-500">Switch Senior:</span>
                      {effectiveSeniors.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelectedSeniorId(s.id)}
                          className={`min-h-[48px] px-4 py-2 rounded-xl text-xs sm:text-sm font-black border-2 transition-all cursor-pointer tactile-button ${
                            s.id === seniorUser.id
                              ? 'bg-emerald-600 text-white border-emerald-700 shadow-sm'
                              : 'bg-slate-100 hover:bg-slate-200 text-slate-800 border-slate-300'
                          }`}
                        >
                          {s.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-xs sm:text-sm text-slate-600">
                  <div className="font-semibold text-slate-800">Caregiver Connected</div>
                  <div>
                    {familyUser.name} ({familyUser.phone})
                  </div>
                  <div className="text-slate-400 text-xs mt-0.5 font-mono">
                    Group: {activeFamilyGroupId}
                  </div>
                </div>
              </div>
            </div>

            {/* Check-In / SOS Feedback Toast */}
            {checkInFeedback && (
              <div
                data-testid="checkin-feedback"
                className={`p-4 sm:p-5 rounded-2xl border-2 shadow-sm animate-fade-in flex items-center justify-between ${
                  checkInFeedback.type === 'SOS'
                    ? 'bg-red-50 border-red-500 text-red-950 ring-2 ring-red-200'
                    : 'bg-emerald-50 border-emerald-400 text-emerald-900'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <span className="text-3xl select-none">
                    {checkInFeedback.type === 'SOS' ? '🚨' : '✅'}
                  </span>
                  <div>
                    <div
                      className={`font-black text-base sm:text-lg ${
                        checkInFeedback.type === 'SOS' ? 'text-red-950' : 'text-emerald-950'
                      }`}
                    >
                      {checkInFeedback.title}
                    </div>
                    <div
                      className={`text-xs sm:text-sm ${
                        checkInFeedback.type === 'SOS'
                          ? 'text-red-800 font-medium'
                          : 'text-emerald-800 font-medium'
                      }`}
                    >
                      {checkInFeedback.message}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setCheckInFeedback(null)}
                  className={`font-black px-4 py-2.5 min-h-[48px] text-sm rounded-xl cursor-pointer transition-colors tactile-button ${
                    checkInFeedback.type === 'SOS'
                      ? 'text-red-900 hover:text-red-950 bg-red-100 hover:bg-red-200 border border-red-300'
                      : 'text-emerald-900 hover:text-emerald-950 bg-emerald-100 hover:bg-emerald-200 border border-emerald-300'
                  }`}
                >
                  Dismiss
                </button>
              </div>
            )}

            {/* Active SOS Emergency Notice for Senior */}
            {activeSosAlerts.some((a) => a.userId === seniorUser.id) && (
              <div
                data-testid="senior-active-sos-banner"
                role="alert"
                className="p-4 sm:p-5 rounded-3xl bg-gradient-to-r from-red-600 to-rose-700 text-white shadow-xl border-3 border-red-400 animate-pulse flex flex-col sm:flex-row sm:items-center justify-between gap-4"
              >
                <div className="flex items-center space-x-3">
                  <span className="text-3xl select-none">🚨</span>
                  <div>
                    <div className="font-black text-base sm:text-lg">
                      Emergency Alert Active — Help is on the way!
                    </div>
                    <div className="text-xs sm:text-sm text-red-100 font-medium">
                      Your family caregiver {familyUser.name} ({familyUser.phone}) has been notified.
                    </div>
                  </div>
                </div>
                <a
                  href={`tel:${familyUser.phone}`}
                  data-testid="senior-call-caregiver-button"
                  className="shrink-0 bg-white hover:bg-red-50 text-red-700 font-black text-sm sm:text-base px-6 py-3.5 rounded-2xl transition-all shadow-md cursor-pointer min-h-[60px] flex items-center justify-center border-2 border-red-200 tactile-button"
                >
                  📞 Call Caregiver
                </a>
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
                  data-testid="senior-button-pills"
                  aria-label="Pills Check-In"
                  onClick={() => handleSeniorCheckIn('PILLS', 'Morning medications taken')}
                  disabled={Boolean(pendingButton)}
                  className={`w-full text-left p-6 sm:p-7 rounded-3xl border-3 sm:border-4 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-lg min-h-[145px] sm:min-h-[160px] tactile-button ${
                    pendingButton === 'PILLS'
                      ? 'opacity-70 bg-blue-100 border-blue-500'
                      : pendingButton
                      ? 'opacity-50 cursor-not-allowed bg-blue-50/50 border-blue-200'
                      : 'bg-gradient-to-br from-blue-50 via-white to-blue-100 hover:from-blue-100 hover:to-indigo-100 border-blue-500 hover:border-blue-700'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="text-5xl sm:text-6xl select-none" role="img" aria-label="Pills">
                      💊
                    </span>
                    <span className="text-xs font-black px-3 py-1 rounded-full bg-blue-200/80 text-blue-950 border border-blue-300">
                      {pendingButton === 'PILLS' ? 'Sending...' : '1-Tap'}
                    </span>
                  </div>

                  <div className="mt-4">
                    <h3 className="text-2xl sm:text-3xl font-black text-blue-950 tracking-tight">
                      Pills
                    </h3>
                    <p className="text-sm sm:text-base font-bold text-blue-900 mt-1">Took My Medication</p>
                  </div>

                  <div className="mt-6 pt-3 border-t border-blue-300/70 flex items-center justify-between text-xs sm:text-sm text-blue-900 font-semibold">
                    <span>Last taken:</span>
                    <span className="font-black">
                      {getLastCheckInTime('PILLS') || 'Not yet today'}
                    </span>
                  </div>
                </button>

                {/* 2. MEAL BUTTON */}
                <button
                  type="button"
                  data-testid="senior-button-meal"
                  aria-label="Meal Check-In"
                  onClick={() => handleSeniorCheckIn('MEAL', 'Finished a healthy meal')}
                  disabled={Boolean(pendingButton)}
                  className={`w-full text-left p-6 sm:p-7 rounded-3xl border-3 sm:border-4 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-lg min-h-[145px] sm:min-h-[160px] tactile-button ${
                    pendingButton === 'MEAL'
                      ? 'opacity-70 bg-emerald-100 border-emerald-500'
                      : pendingButton
                      ? 'opacity-50 cursor-not-allowed bg-emerald-50/50 border-emerald-200'
                      : 'bg-gradient-to-br from-emerald-50 via-white to-emerald-100 hover:from-emerald-100 hover:to-teal-100 border-emerald-500 hover:border-emerald-700'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="text-5xl sm:text-6xl select-none" role="img" aria-label="Meal">
                      🍲
                    </span>
                    <span className="text-xs font-black px-3 py-1 rounded-full bg-emerald-200/80 text-emerald-950 border border-emerald-300">
                      {pendingButton === 'MEAL' ? 'Sending...' : '1-Tap'}
                    </span>
                  </div>

                  <div className="mt-4">
                    <h3 className="text-2xl sm:text-3xl font-black text-emerald-950 tracking-tight">
                      Meal
                    </h3>
                    <p className="text-sm sm:text-base font-bold text-emerald-900 mt-1">Ate My Meal</p>
                  </div>

                  <div className="mt-6 pt-3 border-t border-emerald-300/70 flex items-center justify-between text-xs sm:text-sm text-emerald-900 font-semibold">
                    <span>Last meal:</span>
                    <span className="font-black">
                      {getLastCheckInTime('MEAL') || 'Not yet today'}
                    </span>
                  </div>
                </button>

                {/* 3. MOOD BUTTON */}
                <button
                  type="button"
                  data-testid="senior-button-mood"
                  aria-label="Mood Check-In"
                  onClick={() => handleSeniorCheckIn('MOOD', 'Feeling good and cheerful')}
                  disabled={Boolean(pendingButton)}
                  className={`w-full text-left p-6 sm:p-7 rounded-3xl border-3 sm:border-4 transition-all duration-200 cursor-pointer shadow-sm hover:shadow-lg min-h-[145px] sm:min-h-[160px] tactile-button ${
                    pendingButton === 'MOOD'
                      ? 'opacity-70 bg-purple-100 border-purple-500'
                      : pendingButton
                      ? 'opacity-50 cursor-not-allowed bg-purple-50/50 border-purple-200'
                      : 'bg-gradient-to-br from-purple-50 via-white to-purple-100 hover:from-purple-100 hover:to-pink-100 border-purple-500 hover:border-purple-700'
                  }`}
                >
                  <div className="flex items-start justify-between">
                    <span className="text-5xl sm:text-6xl select-none" role="img" aria-label="Mood">
                      😊
                    </span>
                    <span className="text-xs font-black px-3 py-1 rounded-full bg-purple-200/80 text-purple-950 border border-purple-300">
                      {pendingButton === 'MOOD' ? 'Sending...' : '1-Tap'}
                    </span>
                  </div>

                  <div className="mt-4">
                    <h3 className="text-2xl sm:text-3xl font-black text-purple-950 tracking-tight">
                      Mood
                    </h3>
                    <p className="text-sm sm:text-base font-bold text-purple-900 mt-1">Feeling Good</p>
                  </div>

                  <div className="mt-6 pt-3 border-t border-purple-300/70 flex items-center justify-between text-xs sm:text-sm text-purple-900 font-semibold">
                    <span>Last shared:</span>
                    <span className="font-black">
                      {getLastCheckInTime('MOOD') || 'Not yet today'}
                    </span>
                  </div>
                </button>
              </div>
            </div>

            {/* Large Red SOS Emergency Button */}
            <div className="bg-gradient-to-br from-red-50 via-rose-50 to-red-100 border-3 border-red-400 rounded-3xl p-6 sm:p-8 shadow-sm">
              <div className="flex flex-col md:flex-row items-center justify-between gap-6">
                <div className="flex items-center space-x-4 text-center md:text-left">
                  <div className="w-16 h-16 rounded-2xl bg-red-600 text-white flex items-center justify-center text-3xl shadow-md shrink-0">
                    🚨
                  </div>
                  <div>
                    <div className="inline-flex items-center gap-1.5 bg-red-100 border border-red-300 px-2.5 py-0.5 rounded-full text-xs font-black uppercase tracking-wider text-red-800 mb-1">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      Emergency Assistance
                    </div>
                    <h3 className="text-xl sm:text-2xl font-black text-red-950 tracking-tight">
                      Need Urgent Emergency Help?
                    </h3>
                    <p className="text-xs sm:text-sm text-red-800 mt-1">
                      Pressing this button sends an immediate high-priority SOS alert to your family caregiver{' '}
                      <strong>{familyUser.name}</strong> ({familyUser.phone}).
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  data-testid="senior-sos-button"
                  aria-label="Emergency SOS"
                  onClick={() => setShowSosConfirmDialog(true)}
                  disabled={submittingAlert}
                  className="w-full md:w-auto shrink-0 bg-gradient-to-r from-red-600 via-rose-600 to-red-700 hover:from-red-700 hover:to-rose-800 active:scale-95 text-white font-black text-lg sm:text-xl px-8 py-5 rounded-3xl shadow-xl hover:shadow-2xl border-3 border-red-400 cursor-pointer transition-all duration-150 flex items-center justify-center gap-3.5 ring-4 ring-red-300 min-h-[72px] sm:min-h-[80px] tactile-button"
                >
                  <span className="text-3xl sm:text-4xl select-none animate-bounce">🚨</span>
                  <div className="text-left">
                    <div className="leading-tight tracking-wider uppercase font-black text-xl sm:text-2xl">
                      SOS Emergency
                    </div>
                    <div className="text-xs sm:text-sm font-bold text-red-100 tracking-normal normal-case">
                      Tap to notify family caregiver
                    </div>
                  </div>
                </button>
              </div>
            </div>

            {/* Confirmation Dialog before firing SOS alert */}
            {showSosConfirmDialog && (
              <div
                data-testid="sos-confirm-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="sos-confirm-title"
                onClick={(e) => {
                  if (e.target === e.currentTarget && !submittingAlert) {
                    setShowSosConfirmDialog(false)
                  }
                }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in"
              >
                <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border-4 border-red-500 space-y-6 text-center">
                  <div className="w-20 h-20 mx-auto rounded-3xl bg-red-100 border-4 border-red-300 flex items-center justify-center text-4xl shadow-inner">
                    🚨
                  </div>

                  <div className="space-y-2">
                    <h3
                      id="sos-confirm-title"
                      className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight"
                    >
                      Send Emergency SOS Alert?
                    </h3>
                    <p className="text-slate-700 text-sm sm:text-base leading-relaxed font-medium">
                      Are you sure you want to send an emergency SOS alert? This will immediately notify your
                      family caregiver{' '}
                      <strong className="text-slate-950 font-black">{familyUser.name}</strong> ({familyUser.phone}) with high priority.
                    </p>
                  </div>

                  <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-3.5 text-xs sm:text-sm text-amber-950 font-bold">
                    ⚠️ Only send this alert if you are experiencing an emergency or need urgent help.
                  </div>

                  {errorMsg && (
                    <div className="bg-red-50 border-2 border-red-300 rounded-2xl p-3.5 text-xs sm:text-sm text-red-900 font-black">
                      ⚠️ {errorMsg}
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <button
                      type="button"
                      data-testid="cancel-sos-button"
                      onClick={() => setShowSosConfirmDialog(false)}
                      disabled={submittingAlert}
                      className={`w-full min-h-[60px] py-4 px-5 rounded-2xl border-2 border-slate-300 text-slate-800 font-black text-base sm:text-lg transition-colors tactile-button ${
                        submittingAlert
                          ? 'opacity-50 cursor-not-allowed'
                          : 'hover:bg-slate-100 cursor-pointer'
                      }`}
                    >
                      Cancel
                    </button>

                    <button
                      type="button"
                      data-testid="confirm-sos-button"
                      onClick={handleTriggerSos}
                      disabled={submittingAlert}
                      className={`w-full min-h-[60px] py-4 px-5 rounded-2xl bg-red-600 text-white font-black text-base sm:text-lg shadow-xl transition-all flex items-center justify-center gap-2 tactile-button ${
                        submittingAlert
                          ? 'opacity-70 cursor-wait'
                          : 'hover:bg-red-700 active:scale-95 cursor-pointer ring-2 ring-red-400'
                      }`}
                    >
                      {submittingAlert ? (
                        'Sending...'
                      ) : (
                        <>
                          <span>🚨</span>
                          <span>Yes, Send SOS</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Live Senior Activity Feed */}
            <div data-testid="senior-activity-feed" className="bg-white rounded-2xl p-6 sm:p-7 border border-slate-200 shadow-xs">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-slate-900">
                  Recent Check-In Activity for {seniorUser.name}
                </h3>
                <span className="text-xs font-semibold text-slate-500">
                  {seniorCheckIns.length} logged
                </span>
              </div>

              {seniorCheckIns.length === 0 ? (
                <div className="text-center py-8 text-slate-400">
                  <p className="text-2xl mb-1">📋</p>
                  <p className="text-sm font-medium">No check-ins recorded yet.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {seniorCheckIns.slice(0, 6).map((item) => (
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
            {/* Header banner */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <div className="inline-flex items-center gap-2 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full text-xs font-bold text-emerald-800 mb-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  Family Caregiver Mode • Real-Time Monitor
                </div>
                <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
                  Family Caregiver Dashboard
                </h2>
                <p className="text-slate-600 text-sm mt-0.5">
                  Shared Family Circle:{' '}
                  <code className="bg-slate-200 text-slate-800 px-2 py-0.5 rounded text-xs font-mono font-bold">
                    {activeFamilyGroupId}
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

            {/* Real-time live update toast (visible when Socket.io event arrives) */}
            {lastLiveEvent && (
              <div
                data-testid="family-live-toast"
                className="p-4 sm:p-5 rounded-2xl bg-emerald-600 text-white shadow-md animate-fade-in flex items-center justify-between"
              >
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">⚡</span>
                  <div>
                    <div className="font-bold text-sm sm:text-base">
                      Live Check-In Received via Socket.io!
                    </div>
                    <div className="text-xs text-emerald-100 mt-0.5">
                      [{lastLiveEvent.type}] "{lastLiveEvent.status}" received just now with no refresh.
                    </div>
                  </div>
                </div>
                <span className="text-xs bg-emerald-700/80 border border-emerald-400 font-mono px-3 py-1 rounded-full">
                  Room: {activeFamilyGroupId}
                </span>
              </div>
            )}

            {/* Urgent SOS Emergency Alert Banner (Distinct styling, siren icon, Call Now button) */}
            {activeSosAlerts.length > 0 && (
              <div data-testid="sos-alerts-container" className="space-y-3">
                {activeSosAlerts.map((alertItem) => {
                  const senior =
                    dashboardSeniors.find((s) => s.id === alertItem.userId) ||
                    users.find((u) => u.id === alertItem.userId) ||
                    seniorUser
                  const seniorName = alertItem.user?.name || senior?.name || 'Senior Member'
                  const seniorPhone = alertItem.user?.phone || senior?.phone || '+1-555-0143'

                  return (
                    <div
                      key={alertItem.id}
                      data-testid="sos-alert-banner"
                      role="alert"
                      className="p-5 sm:p-6 rounded-3xl bg-gradient-to-r from-red-700 via-rose-700 to-red-800 text-white shadow-2xl border-4 border-red-500 ring-4 ring-red-400/40 animate-fade-in flex flex-col md:flex-row md:items-center justify-between gap-5"
                    >
                      <div className="flex items-start sm:items-center space-x-4">
                        <span
                          role="img"
                          aria-label="Siren icon"
                          className="text-4xl sm:text-5xl select-none animate-bounce shrink-0"
                        >
                          🚨
                        </span>
                        <div>
                          <div className="inline-flex items-center gap-1.5 bg-red-950/80 border border-red-400/70 px-3 py-0.5 rounded-full text-xs font-black uppercase tracking-wider text-red-200 mb-1.5">
                            <span className="w-2 h-2 rounded-full bg-red-400 animate-ping" />
                            Emergency SOS • Immediate Action Required
                          </div>
                          <h3 className="font-black text-xl sm:text-2xl tracking-tight text-white leading-tight">
                            🚨 EMERGENCY SOS: {seniorName} Needs Immediate Assistance!
                          </h3>
                          <p className="text-xs sm:text-sm text-red-100 mt-1 font-medium">
                            SOS alert triggered {formatCheckInTime(alertItem.timestamp)}. Please contact {seniorName} right away.
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 shrink-0">
                        <a
                          href={`tel:${seniorPhone.replace(/\s+/g, '')}`}
                          data-testid="sos-call-now-button"
                          className="inline-flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 active:scale-95 text-white font-black text-sm sm:text-base px-6 py-3.5 rounded-2xl shadow-lg border-2 border-emerald-300 transition-all cursor-pointer ring-2 ring-emerald-400/50"
                        >
                          <span>📞</span>
                          <span>Call Now ({seniorPhone})</span>
                        </a>

                        <button
                          type="button"
                          data-testid="resolve-sos-button"
                          onClick={() => handleResolveAlert(alertItem.id)}
                          disabled={resolvingAlertId === alertItem.id}
                          className="bg-white/90 hover:bg-white text-red-800 hover:text-red-950 font-extrabold text-xs sm:text-sm px-4 py-3.5 rounded-2xl shadow-xs transition-colors cursor-pointer border border-white/60"
                        >
                          {resolvingAlertId === alertItem.id ? 'Marking Resolved...' : 'Mark Resolved'}
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Red Alert Banner for Missed Senior Check-In ('alert:new' event) */}
            {activeNoCheckInAlerts.length > 0 && (
              <div data-testid="no-checkin-alerts-container" className="space-y-3">
                {activeNoCheckInAlerts.map((alertItem) => {
                  const seniorName =
                    alertItem.user?.name ||
                    users.find((u) => u.id === alertItem.userId)?.name ||
                    dashboardSeniors.find((s) => s.id === alertItem.userId)?.name ||
                    seniorUser.name ||
                    'Senior'
                  return (
                    <div
                      key={alertItem.id}
                      data-testid="no-checkin-alert-banner"
                      role="alert"
                      className="p-4 sm:p-5 rounded-2xl bg-red-600 text-white shadow-lg animate-fade-in flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-2 border-red-700"
                    >
                      <div className="flex items-start sm:items-center space-x-3.5">
                        <div>
                          <div className="font-extrabold text-base sm:text-lg tracking-tight">
                            ⚠️ No check-in for {seniorName}
                          </div>
                          <p className="text-xs sm:text-sm text-red-100 mt-0.5">
                            Safety check-in window exceeded ({formatCheckInTime(alertItem.timestamp)}). Please reach out to verify their wellbeing.
                          </p>
                        </div>
                      </div>
                      <button
                        type="button"
                        data-testid="mark-resolved-button"
                        onClick={() => handleResolveAlert(alertItem.id)}
                        disabled={resolvingAlertId === alertItem.id}
                        className="bg-white hover:bg-red-50 text-red-700 hover:text-red-900 font-extrabold text-xs sm:text-sm px-4 py-2.5 rounded-xl shadow-xs transition-colors cursor-pointer shrink-0"
                      >
                        {resolvingAlertId === alertItem.id ? 'Marking Resolved...' : 'Mark Resolved'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}

            {/* ========================================================== */}
            {/* SENIOR CHECK-IN STATUS CARDS (GREEN / RED)                 */}
            {/* ========================================================== */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="text-xs font-bold tracking-wider text-slate-400 uppercase">
                  Senior Check-In Status
                </div>
                <div className="flex items-center space-x-2 text-xs text-slate-500">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                  <span>Live Socket.io Room: <code className="font-mono text-slate-700">{activeFamilyGroupId}</code></span>
                </div>
              </div>

              <div className="space-y-4">
                {effectiveSeniors.map((senior) => {
                  const hasSosAlert = (senior.activeAlerts || []).some(
                    (a) => a.type === 'SOS' && a.status === 'ACTIVE'
                  )
                  const isGreen = senior.status === 'GREEN' && !hasSosAlert
                  const lastTime = senior.lastCheckInTime || senior.latestCheckIn?.timestamp

                  return (
                    <div
                      key={senior.id}
                      data-testid="senior-status-card"
                      className={`relative overflow-hidden rounded-3xl border-3 transition-all duration-300 p-6 sm:p-8 shadow-sm ${
                        hasSosAlert
                          ? 'bg-gradient-to-br from-red-50 via-white to-rose-100 border-red-500 shadow-red-200 ring-2 ring-red-400/50'
                          : isGreen
                          ? 'bg-gradient-to-br from-emerald-50/90 via-white to-teal-50/40 border-emerald-400 hover:border-emerald-500 shadow-emerald-100/50'
                          : 'bg-gradient-to-br from-rose-50/90 via-white to-amber-50/40 border-rose-400 hover:border-rose-500 shadow-rose-100/50'
                      }`}
                    >
                      {/* Top row: Senior Profile + Status Badge (Green/Red) */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-slate-200/80">
                        <div className="flex items-center space-x-4">
                          <div
                            className={`w-14 h-14 rounded-2xl flex items-center justify-center font-extrabold text-xl shadow-xs select-none ${
                              hasSosAlert
                                ? 'bg-red-600 text-white animate-pulse'
                                : isGreen
                                ? 'bg-emerald-600 text-white'
                                : 'bg-rose-600 text-white'
                            }`}
                          >
                            {getInitials(senior.name, 'SR')}
                          </div>
                          <div>
                            <div className="flex items-center space-x-2">
                              <h3 className="text-2xl font-extrabold text-slate-900 tracking-tight">
                                {senior.name}
                              </h3>
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700">
                                {senior.role}
                              </span>
                            </div>
                            <p className="text-xs text-slate-500 mt-0.5 font-medium">
                              Phone: {senior.phone} • Care Recipient
                            </p>
                          </div>
                        </div>

                        {/* Status Badge (Green / Red / SOS) */}
                        <div data-testid="senior-status-badge">
                          {senior.activeAlerts?.some((a) => a.type === 'SOS') ? (
                            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-black bg-red-600 text-white border-2 border-red-700 shadow-md animate-pulse">
                              <span className="text-base">🚨</span>
                              <span>EMERGENCY SOS ACTIVE</span>
                            </div>
                          ) : isGreen ? (
                            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-extrabold bg-emerald-100 text-emerald-900 border border-emerald-300 shadow-2xs">
                              <span className="relative flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                              </span>
                              <span>SAFE • CHECKED IN</span>
                            </div>
                          ) : (
                            <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs sm:text-sm font-extrabold bg-rose-100 text-rose-900 border border-rose-300 shadow-2xs">
                              <span className="relative flex h-3 w-3">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                                <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500"></span>
                              </span>
                              <span>OVERDUE • ATTENTION NEEDED</span>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Main Card Body: Last Check-In Time & Status Details */}
                      <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                        <div className="space-y-2">
                          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
                            Last Check-In Time
                          </div>
                          <div
                            data-testid="senior-last-checkin-time"
                            className="flex flex-wrap items-baseline gap-2"
                          >
                            <span className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
                              {lastTime ? formatCheckInTime(lastTime) : 'No check-in yet'}
                            </span>
                            {lastTime && (
                              <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-slate-200 text-slate-700">
                                {getRelativeTime(lastTime)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-600">
                            {isGreen
                              ? 'Recent check-in received within normal safety window.'
                              : 'Check-in is overdue. Contact senior to confirm wellbeing.'}
                          </p>
                        </div>

                        {/* Latest Check-In Details / Note */}
                        <div className="bg-white/90 backdrop-blur-xs p-4 rounded-2xl border border-slate-200 shadow-2xs space-y-2">
                          <div className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center justify-between">
                            <span>Latest Logged Activity</span>
                            {senior.latestCheckIn && (
                              <span
                                className={`text-xs font-bold px-2 py-0.5 rounded-md border ${getTypeBadgeClass(
                                  senior.latestCheckIn.type
                                )}`}
                              >
                                {senior.latestCheckIn.type === 'PILLS'
                                  ? '💊 PILLS'
                                  : senior.latestCheckIn.type === 'MEAL'
                                  ? '🍲 MEAL'
                                  : '😊 MOOD'}
                              </span>
                            )}
                          </div>

                          {senior.latestCheckIn ? (
                            <div>
                              <p className="text-sm font-bold text-slate-800">
                                "{senior.latestCheckIn.status}"
                              </p>
                              <p className="text-xs text-slate-500 mt-1">
                                Recorded at:{' '}
                                {new Date(senior.latestCheckIn.timestamp).toLocaleTimeString([], {
                                  hour: 'numeric',
                                  minute: '2-digit',
                                  second: '2-digit',
                                })}
                              </p>
                            </div>
                          ) : (
                            <p className="text-xs text-slate-500 italic">
                              No activity logged yet today.
                            </p>
                          )}
                        </div>
                      </div>

                      {/* Card Footer: Live Room Info */}
                      <div className="mt-6 pt-4 border-t border-slate-200/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs text-slate-500">
                        <div className="flex items-center space-x-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
                          <span>Socket.io Room:</span>
                          <code className="font-mono font-bold text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded">
                            {senior.familyGroupId}
                          </code>
                        </div>
                        <div className="text-slate-500 font-medium">
                          Updates instantly without page refresh on <code className="font-mono font-semibold text-emerald-700">checkin:new</code>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Senior Mood Trend View: Last 7 mood check-ins (Emoji Row & Recharts line chart) */}
            <MoodTrendView
              moodCheckIns={
                moodCheckIns.length > 0
                  ? moodCheckIns
                  : checkIns.filter((c) => c.type === 'MOOD')
              }
              loading={loading && moodLoading}
              seniorName={seniorUser.name}
            />

            {/* Check-ins and Alerts grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Check-Ins Column */}
              <div className="space-y-6">
                {/* Live List of Check-Ins */}
                <div
                  data-testid="live-checkin-list"
                  className="bg-white p-6 sm:p-7 rounded-3xl border border-slate-200 shadow-xs"
                >
                  <div className="flex items-center justify-between mb-4 pb-3 border-b border-slate-100">
                    <div>
                      <div className="flex items-center space-x-2">
                        <h3 className="text-lg font-bold text-slate-900">
                          Live Check-Ins Feed
                        </h3>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <span className="w-1.5 h-1.5 mr-1 rounded-full bg-emerald-500 animate-pulse" />
                          Live Stream
                        </span>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        Real-time Socket.io updates for room {activeFamilyGroupId}
                      </p>
                    </div>
                    <span className="text-xs font-extrabold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full">
                      {checkIns.length} Total
                    </span>
                  </div>

                  {checkIns.length === 0 ? (
                    <div className="text-center py-10 text-slate-400">
                      <p className="text-3xl mb-2">📋</p>
                      <p className="text-sm font-medium">No check-ins logged yet.</p>
                      <p className="text-xs text-slate-400 mt-1">
                        Check in from senior view or submit a manual check-in below.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                      {checkIns.map((item, index) => (
                        <div
                          key={item.id}
                          data-testid="checkin-item"
                          className={`p-3.5 border rounded-2xl flex items-center justify-between transition-all ${
                            index === 0 && lastLiveEvent && lastLiveEvent.id === item.id
                              ? 'bg-emerald-50/80 border-emerald-300 ring-2 ring-emerald-400/20'
                              : 'bg-slate-50/70 hover:bg-slate-100/70 border-slate-200'
                          }`}
                        >
                          <div className="flex items-center space-x-3">
                            <span className="text-2xl select-none">
                              {item.type === 'PILLS' ? '💊' : item.type === 'MEAL' ? '🍲' : '😊'}
                            </span>
                            <div>
                              <div className="flex items-center space-x-2">
                                <span
                                  className={`text-xs font-extrabold px-2 py-0.5 rounded-md border ${getTypeBadgeClass(
                                    item.type
                                  )}`}
                                >
                                  {item.type}
                                </span>
                                <span className="text-sm font-semibold text-slate-800">
                                  {item.status}
                                </span>
                              </div>
                              <p className="text-xs text-slate-500 mt-1">
                                {formatCheckInTime(item.timestamp)} •{' '}
                                <span className="font-medium text-slate-600">
                                  {item.user?.name || seniorUser.name}
                                </span>
                              </p>
                            </div>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                              Saved to DB
                            </span>
                            <span className="text-xs text-slate-400 font-mono">
                              {getRelativeTime(item.timestamp)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Manual Check-In Form */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
                  <h3 className="text-base font-bold text-slate-800 mb-3">
                    Log Check-In for{' '}
                    {effectiveSeniors.find(
                      (s) => s.id === (customSeniorId || seniorUser.id)
                    )?.name || seniorUser.name}
                  </h3>
                  <form onSubmit={handleCustomCheckInSubmit} className="space-y-4">
                    {effectiveSeniors.length > 1 && (
                      <div>
                        <label className="block text-xs font-medium text-slate-700 mb-1">
                          Select Senior
                        </label>
                        <select
                          value={customSeniorId || seniorUser.id}
                          onChange={(e) => setCustomSeniorId(e.target.value)}
                          className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-emerald-500 bg-white"
                        >
                          {effectiveSeniors.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.phone || 'Senior'})
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

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
              </div>

              {/* Alerts & Member Profiles Column */}
              <div className="space-y-6">
                {/* Member Profile Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                    <div className="flex items-center space-x-3 pb-3 border-b border-slate-100">
                      <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-base">
                        {getInitials(seniorUser.name, 'SR')}
                      </div>
                      <div>
                        <h4 className="font-semibold text-slate-800 text-sm">{seniorUser.name}</h4>
                        <span className="text-xs text-slate-500">Senior Care Recipient</span>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-slate-600">
                      <p>
                        <span className="font-medium text-slate-700">Phone:</span> {seniorUser.phone}
                      </p>
                      <p>
                        <span className="font-medium text-slate-700">Role:</span> {seniorUser.role}
                      </p>
                    </div>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-xs">
                    <div className="flex items-center space-x-3 pb-3 border-b border-slate-100">
                      <div className="w-10 h-10 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-base">
                        {getInitials(familyUser.name, 'FM')}
                      </div>
                      <div>
                        <h4 className="font-semibold text-slate-800 text-sm">{familyUser.name}</h4>
                        <span className="text-xs text-slate-500">Primary Caregiver</span>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1 text-xs text-slate-600">
                      <p>
                        <span className="font-medium text-slate-700">Phone:</span> {familyUser.phone}
                      </p>
                      <p>
                        <span className="font-medium text-slate-700">Role:</span> {familyUser.role}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Alert Center */}
                <div className="bg-white p-6 rounded-3xl border border-slate-200 shadow-xs">
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
                              disabled={resolvingAlertId === alert.id}
                              className="bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 font-medium text-xs px-3 py-1.5 rounded-lg shadow-2xs transition-colors cursor-pointer"
                            >
                              {resolvingAlertId === alert.id ? 'Marking Resolved...' : 'Mark Resolved'}
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-200">
                  <h4 className="text-sm font-semibold text-emerald-900 mb-2">
                    Prisma Studio & Socket.io Live Status
                  </h4>
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    Database seeded with Eleanor Vance (Senior) and David Vance (Family) sharing family
                    group <code className="font-mono font-semibold">{activeFamilyGroupId}</code>.
                    Any check-in submitted via the Senior view or API broadcasts in real-time over
                    Socket.io room <code className="font-mono font-semibold">{activeFamilyGroupId}</code>.
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
