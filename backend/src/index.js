import 'dotenv/config'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { Server } from 'socket.io'
import { PrismaClient } from '@prisma/client'
import cron from 'node-cron'
import helmet from 'helmet'
import rateLimit from 'express-rate-limit'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendDist = path.resolve(__dirname, '../../frontend/dist')

const isTestEnv = process.env.NODE_ENV === 'test'

const app = express()
app.disable('x-powered-by')

const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH'],
  },
})

const prisma = new PrismaClient()
const PORT = process.env.PORT || 5000

// HTTP Security Headers via Helmet
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'", 'ws:', 'wss:', 'http:', 'https:'],
        imgSrc: ["'self'", 'data:', 'blob:'],
        fontSrc: ["'self'", 'data:'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  })
)

// Rate Limiting
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isTestEnv ? 5000 : 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests, please try again later.' },
})

const emergencySosLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: isTestEnv ? 500 : 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many SOS requests. Please wait before retrying.' },
})

app.use('/api/', apiLimiter)
app.use('/api/sos', emergencySosLimiter)

app.use(cors())
app.use(express.json({ limit: '10kb' }))

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist, { index: false }))
}

// Socket.io room management for family groups
io.on('connection', (socket) => {
  const queryFamilyGroupId =
    socket.handshake.query?.familyGroupId || socket.handshake.auth?.familyGroupId
  if (queryFamilyGroupId) {
    socket.join(String(queryFamilyGroupId))
  }

  const handleJoin = (room) => {
    if (!room) return
    const targetRoom = typeof room === 'object' ? (room.familyGroupId || room.room || room.id) : room
    if (targetRoom) socket.join(String(targetRoom))
  }

  const handleLeave = (room) => {
    if (!room) return
    const targetRoom = typeof room === 'object' ? (room.familyGroupId || room.room || room.id) : room
    if (targetRoom) socket.leave(String(targetRoom))
  }

  socket.on('join', handleJoin)
  socket.on('join:family', handleJoin)
  socket.on('join_room', handleJoin)
  socket.on('leave', handleLeave)
  socket.on('leave:family', handleLeave)
})

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CareCircle API',
    timestamp: new Date().toISOString(),
  })
})

// Root route: serves frontend in browser, or JSON API overview for API clients
app.get('/', (req, res) => {
  if (fs.existsSync(path.join(frontendDist, 'index.html')) && req.headers.accept?.includes('text/html')) {
    return res.sendFile(path.join(frontendDist, 'index.html'))
  }
  res.json({
    message: 'Welcome to CareCircle API',
    endpoints: {
      health: 'GET /health',
      dashboard: 'GET /api/dashboard/:familyGroupId',
      users: 'GET /api/users, GET /api/users/:id',
      risk: 'GET /api/risk/:userId',
      checkin: 'POST /api/checkin',
      checkins: 'GET /api/checkins, POST /api/checkins',
      alerts: 'GET /api/alerts, POST /api/alerts, PATCH /api/alerts/:id',
      sos: 'POST /api/sos',
    },
  })
})

const ALLOWED_CHECKIN_TYPES = ['PILLS', 'MEAL', 'MOOD']
const ALLOWED_ALERT_TYPES = ['NO_CHECKIN', 'SOS']
const ALLOWED_ALERT_STATUSES = ['ACTIVE', 'RESOLVED']

// Get dashboard summary for a family group (seniors with latest check-in status + recent check-ins)
app.get('/api/dashboard/:familyGroupId', async (req, res) => {
  try {
    const { familyGroupId } = req.params
    if (!familyGroupId || !familyGroupId.trim()) {
      return res.status(400).json({
        success: false,
        error: 'familyGroupId parameter is required',
      })
    }

    const trimmedGroupId = familyGroupId.trim()

    let limit = 20
    if (req.query.limit !== undefined) {
      const parsedLimit = parseInt(req.query.limit, 10)
      if (isNaN(parsedLimit) || parsedLimit <= 0) {
        return res.status(400).json({
          success: false,
          error: 'limit query parameter must be a positive integer',
        })
      }
      limit = Math.min(parsedLimit, 100)
    }

    let thresholdHours = 24
    if (req.query.thresholdHours !== undefined) {
      const parsedHours = parseFloat(req.query.thresholdHours)
      if (isNaN(parsedHours) || parsedHours <= 0) {
        return res.status(400).json({
          success: false,
          error: 'thresholdHours query parameter must be a positive number',
        })
      }
      thresholdHours = parsedHours
    }

    // 1. Fetch all seniors in this family group
    const seniors = await prisma.user.findMany({
      where: {
        familyGroupId: trimmedGroupId,
        role: 'SENIOR',
      },
      include: {
        checkIns: {
          orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
          take: 5,
        },
        alerts: {
          where: { status: 'ACTIVE' },
          orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        },
      },
      orderBy: { name: 'asc' },
    })

    // 2. Fetch recent check-ins for the entire family group
    const recentCheckIns = await prisma.checkIn.findMany({
      where: {
        user: {
          familyGroupId: trimmedGroupId,
        },
      },
      orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
      take: limit,
      include: {
        user: {
          select: { id: true, name: true, role: true, familyGroupId: true, phone: true },
        },
      },
    })

    const now = new Date()
    const thresholdMs = thresholdHours * 60 * 60 * 1000

    // 3. Compute latest check-in status per senior
    const seniorStatuses = seniors.map((senior) => {
      const latestCheckIn = senior.checkIns[0] || null
      const lastCheckInTime = latestCheckIn ? latestCheckIn.timestamp : null

      const isCheckedInRecently = Boolean(
        latestCheckIn && now.getTime() - new Date(latestCheckIn.timestamp).getTime() <= thresholdMs
      )
      const hasActiveAlerts = Boolean(senior.alerts && senior.alerts.length > 0)
      const isSafe = isCheckedInRecently && !hasActiveAlerts

      // Status is GREEN if senior checked in within threshold and has no active alerts, otherwise RED
      const status = isSafe ? 'GREEN' : 'RED'
      const statusColor = isSafe ? 'green' : 'red'

      return {
        id: senior.id,
        name: senior.name,
        role: senior.role,
        phone: senior.phone,
        familyGroupId: senior.familyGroupId,
        status,
        statusColor,
        isCheckedInRecently,
        latestCheckIn,
        lastCheckInTime,
        activeAlerts: (senior.alerts || []).map((a) => ({
          ...a,
          priority: a.type === 'SOS' ? 'HIGH' : 'NORMAL',
        })),
        hasActiveAlerts: senior.alerts.length > 0,
        recentCheckIns: senior.checkIns,
      }
    })

    const primarySenior = seniorStatuses[0] || null
    const hasAnyRed = seniorStatuses.some((s) => s.status === 'RED')
    const overallStatus = seniorStatuses.length === 0 ? 'NONE' : hasAnyRed ? 'RED' : 'GREEN'
    const overallStatusColor = seniorStatuses.length === 0 ? 'gray' : hasAnyRed ? 'red' : 'green'

    res.json({
      success: true,
      data: {
        familyGroupId: trimmedGroupId,
        seniors: seniorStatuses,
        recentCheckIns,
        senior: primarySenior,
        latestCheckIn: primarySenior?.latestCheckIn || null,
        lastCheckInTime: primarySenior?.lastCheckInTime || null,
        status: overallStatus,
        statusColor: overallStatusColor,
      },
      seniors: seniorStatuses,
      recentCheckIns,
      latestCheckIn: primarySenior?.latestCheckIn || null,
      status: overallStatus,
    })
  } catch (error) {
    console.error('Error fetching dashboard:', error)
    res.status(500).json({ success: false, error: 'Internal Server Error' })
  }
})

// Get all users (optional ?familyGroupId= filter)
app.get('/api/users', async (req, res) => {
  try {
    const { familyGroupId } = req.query
    const trimmedGroupId = familyGroupId ? String(familyGroupId).trim() : null
    if (trimmedGroupId && trimmedGroupId.length > 100) {
      return res.status(400).json({ success: false, error: 'familyGroupId must not exceed 100 characters' })
    }
    const users = await prisma.user.findMany({
      where: trimmedGroupId ? { familyGroupId: trimmedGroupId } : undefined,
      include: {
        checkIns: {
          orderBy: { timestamp: 'desc' },
          take: 5,
        },
        alerts: {
          orderBy: { timestamp: 'desc' },
        },
      },
    })
    res.json({ success: true, count: users.length, data: users })
  } catch (error) {
    console.error('Error fetching users:', error)
    res.status(500).json({ success: false, error: 'Internal Server Error' })
  }
})

// Get single user by id
app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params
    if (!id || id.length > 100) {
      return res.status(400).json({ success: false, error: 'Invalid user ID' })
    }
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        checkIns: {
          orderBy: { timestamp: 'desc' },
        },
        alerts: {
          orderBy: { timestamp: 'desc' },
        },
      },
    })
    if (!user) {
      return res.status(404).json({ success: false, error: `User with id '${id}' not found` })
    }
    res.json({ success: true, data: user })
  } catch (error) {
    console.error('Error fetching user:', error)
    res.status(500).json({ success: false, error: 'Internal Server Error' })
  }
})

// Rule-based risk score calculation for last 7 days of check-ins
export function calculateRiskScore(checkIns = [], now = new Date()) {
  const safeNow = now instanceof Date && !isNaN(now.getTime()) ? now : new Date(now)
  const nowDate = isNaN(safeNow.getTime()) ? new Date() : safeNow
  const sevenDaysAgo = new Date(nowDate.getTime() - 7 * 24 * 60 * 60 * 1000)

  // Filter check-ins to the 7-day window
  const recentCheckIns = checkIns.filter((c) => {
    const ts = new Date(c.timestamp).getTime()
    return !isNaN(ts) && ts >= sevenDaysAgo.getTime() && ts <= nowDate.getTime() + 60000
  })

  // 1. skippedMeals = count of MEAL type with status 'Skipped'
  const skippedMeals = recentCheckIns.filter((c) => {
    if (c.type !== 'MEAL') return false
    const s = String(c.status || '').toLowerCase().trim()
    return s === 'skipped' || s.includes('skipped')
  }).length

  // Helper to determine if a pill status means taken
  const isPillTaken = (status) => {
    if (!status) return false
    const s = String(status).toLowerCase().trim()
    return (
      s === 'yes' ||
      s.startsWith('yes') ||
      s === 'taken' ||
      s.includes('pills taken') ||
      s.includes('medication taken') ||
      s.includes('dose taken')
    )
  }

  // Helper for UTC date key 'YYYY-MM-DD'
  const getUtcDateKey = (date) => {
    const d = new Date(date)
    if (isNaN(d.getTime())) return ''
    return d.toISOString().slice(0, 10)
  }

  const todayKey = getUtcDateKey(nowDate)
  const yesterdayKey = getUtcDateKey(new Date(nowDate.getTime() - 86400000))

  // 2. missedPills = count of PILLS type with status != 'Yes' (or no entry that day)
  const missedPills = recentCheckIns.filter((c) => {
    if (c.type !== 'PILLS') return false
    return !isPillTaken(c.status)
  }).length

  // 3. badMoodStreak = consecutive most-recent days with MOOD status 'Not Good'
  const isNotGoodMood = (status) => {
    if (!status) return false
    const s = String(status).toLowerCase().trim()
    return (
      s === 'not good' ||
      s.includes('not good') ||
      s === 'bad' ||
      s.includes('distressed') ||
      s.includes('sad') ||
      s.includes('down')
    )
  }

  const moodCheckIns = recentCheckIns
    .filter((c) => c.type === 'MOOD')
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())

  let badMoodStreak = 0
  if (moodCheckIns.length > 0) {
    const latestMoodByDay = new Map()
    for (const c of moodCheckIns) {
      const key = getUtcDateKey(c.timestamp)
      if (key && !latestMoodByDay.has(key)) {
        latestMoodByDay.set(key, c)
      }
    }

    // Determine the anchor day for the streak: must be today (if logged) or yesterday (if today not yet logged)
    let startDayKey = null
    if (latestMoodByDay.has(todayKey)) {
      const todayMood = latestMoodByDay.get(todayKey)
      if (isNotGoodMood(todayMood.status)) {
        startDayKey = todayKey
      }
      // If today has a check-in and it's Good, streak is broken/reset (badMoodStreak remains 0)
    } else if (latestMoodByDay.has(yesterdayKey)) {
      const yesterdayMood = latestMoodByDay.get(yesterdayKey)
      if (isNotGoodMood(yesterdayMood.status)) {
        startDayKey = yesterdayKey
      }
    }

    if (startDayKey) {
      badMoodStreak = 1
      let currentDay = startDayKey

      while (badMoodStreak < 7) {
        const d = new Date(currentDay + 'T00:00:00.000Z')
        d.setUTCDate(d.getUTCDate() - 1)
        const prevDayKey = d.toISOString().slice(0, 10)

        const prevMood = latestMoodByDay.get(prevDayKey)
        if (prevMood && isNotGoodMood(prevMood.status)) {
          badMoodStreak++
          currentDay = prevDayKey
        } else {
          break
        }
      }
    }
  }

  // 4. riskScore = min(100, missedPills*15 + skippedMeals*10 + badMoodStreak*20)
  const rawScore = missedPills * 15 + skippedMeals * 10 + badMoodStreak * 20
  const riskScore = Math.min(100, Math.max(0, rawScore))

  // level: riskScore<40?'LOW':riskScore<70?'MEDIUM':'HIGH'
  const level = riskScore < 40 ? 'LOW' : riskScore < 70 ? 'MEDIUM' : 'HIGH'

  return {
    riskScore,
    breakdown: {
      missedPills,
      skippedMeals,
      badMoodStreak,
    },
    level,
  }
}

// GET /api/risk/:userId: Calculate rule-based risk score for senior user
app.get('/api/risk/:userId', async (req, res) => {
  try {
    const { userId } = req.params
    if (!userId || !userId.trim()) {
      return res.status(400).json({
        success: false,
        error: 'userId parameter is required',
      })
    }

    const trimmedUserId = userId.trim()
    if (trimmedUserId.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'userId must not exceed 100 characters',
      })
    }
    const user = await prisma.user.findUnique({
      where: { id: trimmedUserId },
    })

    if (!user) {
      return res.status(404).json({
        success: false,
        error: `User with id '${trimmedUserId}' not found`,
      })
    }

    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    const checkIns = await prisma.checkIn.findMany({
      where: {
        userId: user.id,
        timestamp: {
          gte: sevenDaysAgo,
        },
      },
      orderBy: { timestamp: 'desc' },
    })

    const riskData = calculateRiskScore(checkIns, now)

    res.json({
      success: true,
      riskScore: riskData.riskScore,
      breakdown: riskData.breakdown,
      level: riskData.level,
      data: riskData,
    })
  } catch (error) {
    console.error('Error computing risk score:', error)
    res.status(500).json({ success: false, error: 'Internal Server Error' })
  }
})

// Get check-ins
app.get('/api/checkins', async (req, res) => {
  try {
    const { userId, familyGroupId, type, limit } = req.query
    const where = {}
    if (userId) where.userId = String(userId).slice(0, 100)
    if (familyGroupId) where.user = { familyGroupId: String(familyGroupId).slice(0, 100) }
    if (type) {
      const normalizedType = String(type).trim().toUpperCase()
      if (ALLOWED_CHECKIN_TYPES.includes(normalizedType)) {
        where.type = normalizedType
      }
    }
    const checkIns = await prisma.checkIn.findMany({
      where,
      orderBy: { timestamp: 'desc' },
      take: limit ? Math.min(parseInt(limit, 10) || 50, 100) : undefined,
      include: {
        user: {
          select: { id: true, name: true, role: true, familyGroupId: true },
        },
      },
    })
    res.json({ success: true, count: checkIns.length, data: checkIns })
  } catch (error) {
    console.error('Error fetching check-ins:', error)
    res.status(500).json({ success: false, error: 'Internal Server Error' })
  }
})

// Create check-in handler (available via POST /api/checkin and POST /api/checkins)
const handleCreateCheckIn = async (req, res) => {
  try {
    const { userId, type, status, timestamp } = req.body
    const normalizedType = typeof type === 'string' ? type.trim().toUpperCase() : type
    const trimmedStatus = typeof status === 'string' ? status.trim() : ''

    if (!userId || !type || !trimmedStatus) {
      return res.status(400).json({
        success: false,
        error: 'userId, type (PILLS/MEAL/MOOD), and non-empty status are required',
      })
    }

    if (typeof userId !== 'string' || userId.trim().length > 100) {
      return res.status(400).json({
        success: false,
        error: 'userId must be a valid string not exceeding 100 characters',
      })
    }

    if (trimmedStatus.length > 500) {
      return res.status(400).json({
        success: false,
        error: 'status must not exceed 500 characters',
      })
    }

    if (!ALLOWED_CHECKIN_TYPES.includes(normalizedType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid check-in type '${type}'. Allowed types: ${ALLOWED_CHECKIN_TYPES.join(', ')}`,
      })
    }

    const trimmedUserId = userId.trim()
    const user = await prisma.user.findUnique({ where: { id: trimmedUserId } })
    if (!user) {
      return res.status(404).json({
        success: false,
        error: `User with id '${userId}' not found`,
      })
    }

    const checkIn = await prisma.checkIn.create({
      data: {
        userId: trimmedUserId,
        type: normalizedType,
        status: trimmedStatus,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
      },
      include: {
        user: true,
      },
    })

    // Emit Socket.io event 'checkin:new' to that familyGroupId's room
    if (user.familyGroupId) {
      io.to(user.familyGroupId).emit('checkin:new', checkIn)
    }

    clearAlertResolution(trimmedUserId)

    res.status(201).json({ success: true, data: checkIn })
  } catch (error) {
    console.error('Error creating check-in:', error)
    res.status(500).json({ success: false, error: 'Internal Server Error' })
  }
}

app.post('/api/checkin', handleCreateCheckIn)
app.post('/api/checkins', handleCreateCheckIn)

// Get alerts (optional ?userId=, ?status=, ?familyGroupId=)
app.get('/api/alerts', async (req, res) => {
  try {
    const { userId, status, familyGroupId } = req.query
    if (status && !ALLOWED_ALERT_STATUSES.includes(String(status).trim().toUpperCase())) {
      return res.status(400).json({
        success: false,
        error: `Invalid status '${status}'. Allowed statuses: ${ALLOWED_ALERT_STATUSES.join(', ')}`,
      })
    }
    const alerts = await prisma.alert.findMany({
      where: {
        ...(userId ? { userId: String(userId) } : {}),
        ...(status ? { status: String(status).trim().toUpperCase() } : {}),
        ...(familyGroupId ? { user: { familyGroupId: String(familyGroupId) } } : {}),
      },
      orderBy: { timestamp: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, role: true, familyGroupId: true, phone: true },
        },
      },
    })
    const alertsWithPriority = alerts.map((alert) => ({
      ...alert,
      priority: alert.type === 'SOS' ? 'HIGH' : 'NORMAL',
    }))
    res.json({ success: true, count: alertsWithPriority.length, data: alertsWithPriority })
  } catch (error) {
    console.error('Error fetching alerts:', error)
    res.status(500).json({ success: false, error: 'Internal Server Error' })
  }
})

// Create alert
app.post('/api/alerts', async (req, res) => {
  try {
    const { userId, type, status, timestamp } = req.body
    if (!userId || !type) {
      return res.status(400).json({
        success: false,
        error: 'userId and type (NO_CHECKIN/SOS) are required',
      })
    }

    if (typeof userId !== 'string' || userId.trim().length > 100) {
      return res.status(400).json({
        success: false,
        error: 'userId must be a valid string not exceeding 100 characters',
      })
    }

    if (!ALLOWED_ALERT_TYPES.includes(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid alert type '${type}'. Allowed types: ${ALLOWED_ALERT_TYPES.join(', ')}`,
      })
    }

    if (status && !ALLOWED_ALERT_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: `status must be ACTIVE or RESOLVED`,
      })
    }

    const trimmedUserId = userId.trim()
    const user = await prisma.user.findUnique({ where: { id: trimmedUserId } })
    if (!user) {
      return res.status(404).json({
        success: false,
        error: `User with id '${userId}' not found`,
      })
    }

    const alert = await prisma.alert.create({
      data: {
        userId: trimmedUserId,
        type,
        status: status || 'ACTIVE',
        timestamp: timestamp ? new Date(timestamp) : new Date(),
      },
      include: {
        user: true,
      },
    })

    const alertPayload = {
      ...alert,
      priority: alert.type === 'SOS' ? 'HIGH' : 'NORMAL',
    }

    // Emit Socket.io event 'alert:new' to senior's familyGroupId room
    if (user.familyGroupId) {
      io.to(user.familyGroupId).emit('alert:new', alertPayload)
    } else {
      io.emit('alert:new', alertPayload)
    }

    res.status(201).json({ success: true, data: alertPayload })
  } catch (error) {
    console.error('Error creating alert:', error)
    res.status(500).json({ success: false, error: 'Internal Server Error' })
  }
})

// POST /api/sos: creates Alert (type SOS, high priority), emits 'alert:sos' immediately (no cron delay)
app.post('/api/sos', async (req, res) => {
  try {
    const { userId } = req.body
    if (!userId || typeof userId !== 'string' || !userId.trim()) {
      return res.status(400).json({
        success: false,
        error: 'userId is required',
      })
    }

    const trimmedUserId = userId.trim()
    if (trimmedUserId.length > 100) {
      return res.status(400).json({
        success: false,
        error: 'userId must not exceed 100 characters',
      })
    }

    const user = await prisma.user.findUnique({
      where: { id: trimmedUserId },
    })

    if (!user) {
      return res.status(404).json({
        success: false,
        error: `User with id '${trimmedUserId}' not found`,
      })
    }

    const alert = await prisma.alert.create({
      data: {
        userId: user.id,
        type: 'SOS',
        status: 'ACTIVE',
        timestamp: new Date(),
      },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            role: true,
            phone: true,
            familyGroupId: true,
          },
        },
      },
    })

    const alertPayload = {
      ...alert,
      priority: 'HIGH',
    }

    // Emit Socket.io 'alert:sos' immediately (no cron delay) to senior's familyGroupId room
    if (user.familyGroupId) {
      io.to(user.familyGroupId).emit('alert:sos', alertPayload)
      io.to(user.familyGroupId).emit('alert:new', alertPayload)
    } else {
      io.emit('alert:sos', alertPayload)
      io.emit('alert:new', alertPayload)
    }

    clearAlertResolution(user.id)

    res.status(201).json({
      success: true,
      data: alertPayload,
    })
  } catch (error) {
    console.error('Error creating SOS alert:', error)
    res.status(500).json({ success: false, error: 'Internal Server Error' })
  }
})

// Update alert status (e.g. resolve)
app.patch('/api/alerts/:id', async (req, res) => {
  const { id } = req.params
  if (!id || typeof id !== 'string' || id.length > 100) {
    return res.status(400).json({
      success: false,
      error: 'Invalid alert ID',
    })
  }
  try {
    const { status } = req.body
    if (!status || !ALLOWED_ALERT_STATUSES.includes(status)) {
      return res.status(400).json({
        success: false,
        error: 'status must be ACTIVE or RESOLVED',
      })
    }

    const updatedAlert = await prisma.alert.update({
      where: { id },
      data: { status },
      include: {
        user: true,
      },
    })

    // Record resolution time to enforce cooldown before any re-alerting
    if (status === 'RESOLVED') {
      recordAlertResolution(updatedAlert.userId)
    }

    const alertWithPriority = {
      ...updatedAlert,
      priority: updatedAlert.type === 'SOS' ? 'HIGH' : 'NORMAL',
    }

    // Emit Socket.io events when alert is updated/resolved
    if (updatedAlert.user?.familyGroupId) {
      io.to(updatedAlert.user.familyGroupId).emit('alert:updated', alertWithPriority)
      if (status === 'RESOLVED') {
        io.to(updatedAlert.user.familyGroupId).emit('alert:resolved', alertWithPriority)
      }
    } else {
      io.emit('alert:updated', alertWithPriority)
      if (status === 'RESOLVED') {
        io.emit('alert:resolved', alertWithPriority)
      }
    }

    res.json({ success: true, data: alertWithPriority })
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: `Alert with id '${id}' not found`,
      })
    }
    console.error('Error updating alert:', error)
    res.status(500).json({ success: false, error: 'Internal Server Error' })
  }
})

// ==============================================================
// CRON JOB: Periodically check senior check-in status (node-cron)
// Threshold defaults to 2 minutes for demo as specified in requirements
// ==============================================================
export const DEFAULT_CHECKIN_THRESHOLD_MS =
  parseInt(process.env.CHECKIN_THRESHOLD_MS, 10) || 2 * 60 * 1000

// Map to track resolution timestamp per senior to ensure a full grace window
export const lastAlertResolutionTime = new Map()

export function recordAlertResolution(userId) {
  if (userId) {
    lastAlertResolutionTime.set(String(userId), Date.now())
  }
}

export function clearAlertResolution(userId) {
  if (userId) {
    lastAlertResolutionTime.delete(String(userId))
  }
}

export async function checkSeniorCheckIns(thresholdMs = DEFAULT_CHECKIN_THRESHOLD_MS) {
  const now = new Date()
  const createdAlerts = []

  // Fetch all seniors with their latest check-in and active NO_CHECKIN alerts
  const seniors = await prisma.user.findMany({
    where: { role: 'SENIOR' },
    include: {
      checkIns: {
        orderBy: [{ timestamp: 'desc' }, { id: 'desc' }],
        take: 1,
      },
      alerts: {
        where: {
          type: 'NO_CHECKIN',
          status: 'ACTIVE',
        },
      },
    },
  })

  for (const senior of seniors) {
    const latestCheckIn = senior.checkIns[0] || null
    const referenceTime = latestCheckIn
      ? new Date(latestCheckIn.timestamp).getTime()
      : new Date(senior.createdAt).getTime()

    const gap = now.getTime() - referenceTime

    if (gap > thresholdMs) {
      // 1. Skip if senior already has an active NO_CHECKIN alert (prevent duplicate spam)
      if (senior.alerts.length > 0) {
        continue
      }

      // 2. Skip if an alert was resolved within thresholdMs (resolution cooldown window)
      const lastResolved = lastAlertResolutionTime.get(senior.id)
      if (lastResolved && now.getTime() - lastResolved < thresholdMs) {
        continue
      }

      // 3. Skip if a NO_CHECKIN alert was recently created within thresholdMs
      const recentAlert = await prisma.alert.findFirst({
        where: {
          userId: senior.id,
          type: 'NO_CHECKIN',
          timestamp: {
            gt: new Date(now.getTime() - thresholdMs),
          },
        },
        orderBy: { timestamp: 'desc' },
      })
      if (recentAlert) {
        continue
      }

      // 4. Create Alert row (type NO_CHECKIN, status ACTIVE)
      const alert = await prisma.alert.create({
        data: {
          userId: senior.id,
          type: 'NO_CHECKIN',
          status: 'ACTIVE',
          timestamp: now,
        },
        include: {
          user: true,
        },
      })

      createdAlerts.push(alert)

      // 5. Emit 'alert:new' via Socket.io to senior's familyGroupId room
      if (senior.familyGroupId) {
        io.to(senior.familyGroupId).emit('alert:new', alert)
      } else {
        io.emit('alert:new', alert)
      }
    }
  }

  return createdAlerts
}

let cronTask = null
let isChecking = false

export function startCheckInCron(
  cronExpression = '* * * * *',
  thresholdMs = DEFAULT_CHECKIN_THRESHOLD_MS
) {
  if (cronTask) {
    return cronTask
  }
  cronTask = cron.schedule(cronExpression, async () => {
    if (isChecking) return
    isChecking = true
    try {
      await checkSeniorCheckIns(thresholdMs)
    } catch (err) {
      console.error('Error executing checkSeniorCheckIns cron job:', err)
    } finally {
      isChecking = false
    }
  })
  return cronTask
}

export function stopCheckInCron() {
  if (cronTask) {
    cronTask.stop()
    cronTask = null
  }
  isChecking = false
}

const isMain =
  process.argv[1] &&
  (process.argv[1].endsWith('src/index.js') || process.argv[1].endsWith('src\\index.js'))

if (isMain) {
  server.listen(PORT, () => {
    console.log(`CareCircle backend server running on http://localhost:${PORT}`)
  })
  startCheckInCron()
}

export {
  app,
  server,
  io,
  prisma,
  cronTask,
}
export default app
