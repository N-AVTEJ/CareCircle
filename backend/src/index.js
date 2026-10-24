import 'dotenv/config'
import http from 'node:http'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import cors from 'cors'
import { Server } from 'socket.io'
import { PrismaClient } from '@prisma/client'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const frontendDist = path.resolve(__dirname, '../../frontend/dist')

const app = express()
const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'PATCH'],
  },
})

const prisma = new PrismaClient()
const PORT = process.env.PORT || 5000

app.use(cors())
app.use(express.json())

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

  socket.on('join', handleJoin)
  socket.on('join:family', handleJoin)
  socket.on('join_room', handleJoin)
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
      users: 'GET /api/users, GET /api/users/:id',
      checkin: 'POST /api/checkin',
      checkins: 'GET /api/checkins, POST /api/checkins',
      alerts: 'GET /api/alerts, POST /api/alerts, PATCH /api/alerts/:id',
    },
  })
})

const ALLOWED_CHECKIN_TYPES = ['PILLS', 'MEAL', 'MOOD']
const ALLOWED_ALERT_TYPES = ['NO_CHECKIN', 'SOS']
const ALLOWED_ALERT_STATUSES = ['ACTIVE', 'RESOLVED']

// Get all users (optional ?familyGroupId= filter)
app.get('/api/users', async (req, res) => {
  try {
    const { familyGroupId } = req.query
    const users = await prisma.user.findMany({
      where: familyGroupId ? { familyGroupId: String(familyGroupId) } : undefined,
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
    res.status(500).json({ success: false, error: error.message })
  }
})

// Get single user by id
app.get('/api/users/:id', async (req, res) => {
  try {
    const { id } = req.params
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
    res.status(500).json({ success: false, error: error.message })
  }
})

// Get check-ins
app.get('/api/checkins', async (req, res) => {
  try {
    const { userId, familyGroupId, type, limit } = req.query
    const where = {}
    if (userId) where.userId = String(userId)
    if (familyGroupId) where.user = { familyGroupId: String(familyGroupId) }
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
    res.status(500).json({ success: false, error: error.message })
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

    if (!ALLOWED_CHECKIN_TYPES.includes(normalizedType)) {
      return res.status(400).json({
        success: false,
        error: `Invalid check-in type '${type}'. Allowed types: ${ALLOWED_CHECKIN_TYPES.join(', ')}`,
      })
    }

    const user = await prisma.user.findUnique({ where: { id: String(userId) } })
    if (!user) {
      return res.status(404).json({
        success: false,
        error: `User with id '${userId}' not found`,
      })
    }

    const checkIn = await prisma.checkIn.create({
      data: {
        userId: String(userId),
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

    res.status(201).json({ success: true, data: checkIn })
  } catch (error) {
    console.error('Error creating check-in:', error)
    res.status(500).json({ success: false, error: error.message })
  }
}

app.post('/api/checkin', handleCreateCheckIn)
app.post('/api/checkins', handleCreateCheckIn)

// Get alerts
app.get('/api/alerts', async (req, res) => {
  try {
    const { userId, status } = req.query
    const alerts = await prisma.alert.findMany({
      where: {
        ...(userId ? { userId: String(userId) } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { timestamp: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, role: true, familyGroupId: true },
        },
      },
    })
    res.json({ success: true, count: alerts.length, data: alerts })
  } catch (error) {
    console.error('Error fetching alerts:', error)
    res.status(500).json({ success: false, error: error.message })
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

    const user = await prisma.user.findUnique({ where: { id: String(userId) } })
    if (!user) {
      return res.status(404).json({
        success: false,
        error: `User with id '${userId}' not found`,
      })
    }

    const alert = await prisma.alert.create({
      data: {
        userId,
        type,
        status: status || 'ACTIVE',
        timestamp: timestamp ? new Date(timestamp) : new Date(),
      },
      include: {
        user: true,
      },
    })
    res.status(201).json({ success: true, data: alert })
  } catch (error) {
    console.error('Error creating alert:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

// Update alert status (e.g. resolve)
app.patch('/api/alerts/:id', async (req, res) => {
  const { id } = req.params
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
    })
    res.json({ success: true, data: updatedAlert })
  } catch (error) {
    if (error.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: `Alert with id '${id}' not found`,
      })
    }
    console.error('Error updating alert:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

const isMain = process.argv[1] && (process.argv[1].endsWith('src/index.js') || process.argv[1].endsWith('src\\index.js'))

if (isMain) {
  server.listen(PORT, () => {
    console.log(`CareCircle backend server running on http://localhost:${PORT}`)
  })
}

export { app, server, io, prisma }
export default app
