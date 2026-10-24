import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import { PrismaClient } from '@prisma/client'

const app = express()
const prisma = new PrismaClient()
const PORT = process.env.PORT || 5000

app.use(cors())
app.use(express.json())

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'CareCircle API',
    timestamp: new Date().toISOString(),
  })
})

// Root route
app.get('/', (req, res) => {
  res.json({
    message: 'Welcome to CareCircle API',
    endpoints: {
      health: 'GET /health',
      users: 'GET /api/users',
      checkins: 'GET /api/checkins, POST /api/checkins',
      alerts: 'GET /api/alerts, POST /api/alerts, PATCH /api/alerts/:id',
    },
  })
})

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

// Get check-ins
app.get('/api/checkins', async (req, res) => {
  try {
    const { userId } = req.query
    const checkIns = await prisma.checkIn.findMany({
      where: userId ? { userId: String(userId) } : undefined,
      orderBy: { timestamp: 'desc' },
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

// Create check-in
app.post('/api/checkins', async (req, res) => {
  try {
    const { userId, type, status, timestamp } = req.body
    if (!userId || !type || !status) {
      return res.status(400).json({
        success: false,
        error: 'userId, type (PILLS/MEAL/MOOD), and status are required',
      })
    }

    const checkIn = await prisma.checkIn.create({
      data: {
        userId,
        type,
        status,
        timestamp: timestamp ? new Date(timestamp) : new Date(),
      },
      include: {
        user: true,
      },
    })
    res.status(201).json({ success: true, data: checkIn })
  } catch (error) {
    console.error('Error creating check-in:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

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
  try {
    const { id } = req.params
    const { status } = req.body
    if (!status || !['ACTIVE', 'RESOLVED'].includes(status)) {
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
    console.error('Error updating alert:', error)
    res.status(500).json({ success: false, error: error.message })
  }
})

if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    console.log(`CareCircle backend server running on http://localhost:${PORT}`)
  })
}

export default app
