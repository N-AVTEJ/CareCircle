import assert from 'node:assert/strict'
import { server, io, prisma } from '../src/index.js'
import { io as Client } from 'socket.io-client'

async function runVerification() {
  console.log('🚀 Starting Senior Check-In & Socket.io Room Verification...')

  // 1. Start server on ephemeral port
  const port = await new Promise((resolve) => {
    server.listen(0, () => resolve(server.address().port))
  })
  const baseUrl = `http://localhost:${port}`
  console.log(`📡 Backend server listening on ${baseUrl}`)

  const HARDCODED_SENIOR_USER_ID = 'ffd75d01-03e9-4138-abd1-b095ac5ba212'
  const FAMILY_GROUP_ID = 'fam_group_carecircle_101'

  // Verify Senior user exists in database
  const senior = await prisma.user.findUnique({
    where: { id: HARDCODED_SENIOR_USER_ID },
  })
  assert.ok(senior, `Senior user ${HARDCODED_SENIOR_USER_ID} must exist in DB`)
  console.log(`👤 Senior user verified in DB: ${senior.name} (${senior.role}) in group ${senior.familyGroupId}`)

  // 2. Connect Socket.io client subscribed to familyGroupId room
  const socket = Client(baseUrl, {
    query: { familyGroupId: FAMILY_GROUP_ID },
    transports: ['websocket'],
  })

  await new Promise((resolve) => socket.on('connect', resolve))
  console.log(`🔌 Socket.io client connected and joined room: ${FAMILY_GROUP_ID}`)

  const receivedEvents = []
  socket.on('checkin:new', (event) => {
    receivedEvents.push(event)
  })

  // 3. Simulate clicking the 3 Senior View buttons (Pills, Meal, Mood)
  const buttonsToTest = [
    { type: 'PILLS', status: 'Morning blood pressure pills taken' },
    { type: 'MEAL', status: 'Ate balanced lunch with tea' },
    { type: 'MOOD', status: 'Feeling cheerful and energized' },
  ]

  const createdCheckInIds = []

  for (const button of buttonsToTest) {
    console.log(`👉 Clicking Senior Button: [ ${button.type} ] -> "${button.status}"`)
    const res = await fetch(`${baseUrl}/api/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: HARDCODED_SENIOR_USER_ID,
        type: button.type,
        status: button.status,
      }),
    })

    assert.equal(res.status, 201, `POST /api/checkin for ${button.type} should return 201`)
    const json = await res.json()
    assert.equal(json.success, true)
    assert.equal(json.data.type, button.type)
    assert.equal(json.data.status, button.status)
    assert.equal(json.data.userId, HARDCODED_SENIOR_USER_ID)
    createdCheckInIds.push(json.data.id)
    console.log(`   ✅ HTTP 201 Created: ID=${json.data.id}`)
  }

  // Wait for Socket.io events
  await new Promise((r) => setTimeout(r, 200))
  assert.equal(
    receivedEvents.length,
    3,
    `Expected 3 Socket.io 'checkin:new' events, got ${receivedEvents.length}`
  )
  console.log(`⚡ Received ${receivedEvents.length} real-time 'checkin:new' Socket.io events:`)
  receivedEvents.forEach((ev) => {
    console.log(`   - [${ev.type}] "${ev.status}" for User ID: ${ev.userId}`)
  })

  // 4. Verify rows directly in CheckIn PostgreSQL database table
  console.log(`🔍 Inspecting CheckIn table in PostgreSQL database via Prisma...`)
  for (const id of createdCheckInIds) {
    const row = await prisma.checkIn.findUnique({
      where: { id },
      include: {
        user: { select: { name: true, role: true, familyGroupId: true } },
      },
    })
    assert.ok(row, `Row with id ${id} must exist in CheckIn table`)
    assert.equal(row.userId, HARDCODED_SENIOR_USER_ID)
    assert.equal(row.user.familyGroupId, FAMILY_GROUP_ID)
    console.log(`   📋 CheckIn Table Row Confirmed:`, {
      id: row.id,
      userId: row.userId,
      userName: row.user.name,
      type: row.type,
      status: row.status,
      timestamp: row.timestamp.toISOString(),
      familyGroupId: row.user.familyGroupId,
    })
  }

  // Cleanup
  socket.disconnect()
  io.close()
  server.closeAllConnections?.()
  await new Promise((r) => server.close(r))
  await prisma.$disconnect()

  console.log('\n🎉 ALL VERIFICATIONS PASSED: 3 Senior check-in rows successfully persisted in CheckIn table and broadcast over Socket.io!')
}

runVerification().catch((err) => {
  console.error('❌ Verification failed:', err)
  process.exit(1)
})
