import test from 'node:test'
import assert from 'node:assert/strict'
import { app, server, io, prisma } from '../src/index.js'
import { io as Client } from 'socket.io-client'

let baseUrl

test.before(async () => {
  await new Promise((resolve) => {
    server.listen(0, () => {
      const port = server.address().port
      baseUrl = `http://localhost:${port}`
      resolve()
    })
  })
})

test.after(async () => {
  io.close()
  if (server) {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
  }
  await prisma.$disconnect()
})

test('GET /health returns status ok', async () => {
  const res = await fetch(`${baseUrl}/health`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.status, 'ok')
  assert.equal(data.service, 'CareCircle API')
})

test('GET / returns API overview and endpoints', async () => {
  const res = await fetch(`${baseUrl}/`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.ok(data.message.includes('CareCircle API'))
  assert.ok(data.endpoints.health)
  assert.ok(data.endpoints.users)
})

test('GET /api/users returns seeded senior and family users', async () => {
  const res = await fetch(`${baseUrl}/api/users`)
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.success, true)
  assert.ok(json.count >= 2)

  const senior = json.data.find((u) => u.role === 'SENIOR')
  const family = json.data.find((u) => u.role === 'FAMILY')

  assert.ok(senior, 'Senior user should exist')
  assert.ok(family, 'Family user should exist')
  assert.equal(senior.familyGroupId, family.familyGroupId, 'Both users must share familyGroupId')
  assert.equal(senior.familyGroupId, 'fam_group_carecircle_101')
})

test('GET /api/users/:id returns single user details', async () => {
  const usersRes = await fetch(`${baseUrl}/api/users`)
  const { data: users } = await usersRes.json()
  const senior = users.find((u) => u.role === 'SENIOR')

  const res = await fetch(`${baseUrl}/api/users/${senior.id}`)
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.success, true)
  assert.equal(json.data.id, senior.id)
  assert.equal(json.data.role, 'SENIOR')
})

test('GET /api/users/:id returns 404 for non-existent user', async () => {
  const res = await fetch(`${baseUrl}/api/users/non-existent-user-id`)
  assert.equal(res.status, 404)
  const json = await res.json()
  assert.equal(json.success, false)
})

test('POST /api/checkin creates a new check-in and persists row in CheckIn table', async () => {
  const usersRes = await fetch(`${baseUrl}/api/users`)
  const { data: users } = await usersRes.json()
  const senior = users.find((u) => u.role === 'SENIOR')

  const res = await fetch(`${baseUrl}/api/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: senior.id,
      type: 'PILLS',
      status: 'Morning medication taken',
    }),
  })
  assert.equal(res.status, 201)
  const json = await res.json()
  assert.equal(json.success, true)
  assert.equal(json.data.type, 'PILLS')
  assert.equal(json.data.status, 'Morning medication taken')
  assert.equal(json.data.userId, senior.id)

  // Verify direct database persistence in CheckIn table
  const dbRecord = await prisma.checkIn.findUnique({
    where: { id: json.data.id },
  })
  assert.ok(dbRecord, 'CheckIn row must exist in database')
  assert.equal(dbRecord.userId, senior.id)
  assert.equal(dbRecord.type, 'PILLS')
  assert.equal(dbRecord.status, 'Morning medication taken')
})

test('POST /api/checkin emits Socket.io event "checkin:new" to familyGroupId room', async () => {
  const usersRes = await fetch(`${baseUrl}/api/users`)
  const { data: users } = await usersRes.json()
  const senior = users.find((u) => u.role === 'SENIOR')

  // Socket 1: listening in senior's familyGroupId room
  const socketSameFamily = Client(baseUrl, {
    query: { familyGroupId: senior.familyGroupId },
    transports: ['websocket'],
  })

  // Socket 2: listening in an unrelated room
  const socketOtherFamily = Client(baseUrl, {
    query: { familyGroupId: 'unrelated_family_group_999' },
    transports: ['websocket'],
  })

  await Promise.all([
    new Promise((resolve) => socketSameFamily.on('connect', resolve)),
    new Promise((resolve) => socketOtherFamily.on('connect', resolve)),
  ])

  let otherRoomReceived = false
  socketOtherFamily.on('checkin:new', () => {
    otherRoomReceived = true
  })

  const eventPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for checkin:new event')), 4000)
    socketSameFamily.on('checkin:new', (payload) => {
      clearTimeout(timeout)
      resolve(payload)
    })
  })

  const res = await fetch(`${baseUrl}/api/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: senior.id,
      type: 'MOOD',
      status: 'Feeling great and cheerful',
    }),
  })
  assert.equal(res.status, 201)

  const received = await eventPromise
  assert.equal(received.type, 'MOOD')
  assert.equal(received.status, 'Feeling great and cheerful')
  assert.equal(received.userId, senior.id)

  await new Promise((r) => setTimeout(r, 100))
  assert.equal(otherRoomReceived, false, 'Unrelated room must NOT receive the checkin:new event')

  socketSameFamily.disconnect()
  socketOtherFamily.disconnect()
})

test('POST /api/checkin rejects missing fields with 400', async () => {
  const res = await fetch(`${baseUrl}/api/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'PILLS',
    }),
  })
  assert.equal(res.status, 400)
  const json = await res.json()
  assert.equal(json.success, false)
})

test('POST /api/checkin rejects invalid check-in type with 400', async () => {
  const usersRes = await fetch(`${baseUrl}/api/users`)
  const { data: users } = await usersRes.json()
  const senior = users.find((u) => u.role === 'SENIOR')

  const res = await fetch(`${baseUrl}/api/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: senior.id,
      type: 'UNKNOWN_TYPE',
      status: 'Some status',
    }),
  })
  assert.equal(res.status, 400)
  const json = await res.json()
  assert.equal(json.success, false)
})

test('Senior view 3 buttons (Pills, Meal, Mood) post check-in and create row in CheckIn table', async () => {
  const HARDCODED_SENIOR_USER_ID = 'ffd75d01-03e9-4138-abd1-b095ac5ba212'
  const buttonConfigs = [
    { type: 'PILLS', status: 'Morning medications taken' },
    { type: 'MEAL', status: 'Finished a healthy meal' },
    { type: 'MOOD', status: 'Feeling good and cheerful' },
  ]

  for (const config of buttonConfigs) {
    const res = await fetch(`${baseUrl}/api/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: HARDCODED_SENIOR_USER_ID,
        type: config.type,
        status: config.status,
      }),
    })
    assert.equal(res.status, 201)
    const json = await res.json()
    assert.equal(json.success, true)
    assert.equal(json.data.userId, HARDCODED_SENIOR_USER_ID)
    assert.equal(json.data.type, config.type)
    assert.equal(json.data.status, config.status)

    // Verify row creation in CheckIn table
    const dbRow = await prisma.checkIn.findUnique({
      where: { id: json.data.id },
      include: { user: true },
    })
    assert.ok(dbRow, `CheckIn row for ${config.type} must exist in DB table`)
    assert.equal(dbRow.userId, HARDCODED_SENIOR_USER_ID)
    assert.equal(dbRow.type, config.type)
    assert.equal(dbRow.status, config.status)
    assert.equal(dbRow.user.name, 'Eleanor Vance')
    assert.equal(dbRow.user.familyGroupId, 'fam_group_carecircle_101')
  }
})

test('POST /api/checkins creates a new check-in for senior', async () => {
  const usersRes = await fetch(`${baseUrl}/api/users`)
  const { data: users } = await usersRes.json()
  const senior = users.find((u) => u.role === 'SENIOR')

  const res = await fetch(`${baseUrl}/api/checkins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: senior.id,
      type: 'MEAL',
      status: 'Lunch completed',
    }),
  })
  assert.equal(res.status, 201)
  const json = await res.json()
  assert.equal(json.success, true)
  assert.equal(json.data.type, 'MEAL')
  assert.equal(json.data.status, 'Lunch completed')
  assert.equal(json.data.userId, senior.id)
})

test('POST /api/checkins rejects missing fields with 400', async () => {
  const res = await fetch(`${baseUrl}/api/checkins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'MEAL',
    }),
  })
  assert.equal(res.status, 400)
  const json = await res.json()
  assert.equal(json.success, false)
})

test('POST /api/checkins rejects invalid check-in type with 400', async () => {
  const usersRes = await fetch(`${baseUrl}/api/users`)
  const { data: users } = await usersRes.json()
  const senior = users.find((u) => u.role === 'SENIOR')

  const res = await fetch(`${baseUrl}/api/checkins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: senior.id,
      type: 'INVALID_TYPE',
      status: 'Test status',
    }),
  })
  assert.equal(res.status, 400)
  const json = await res.json()
  assert.equal(json.success, false)
  assert.ok(json.error.includes('Allowed types'))
})

test('POST /api/checkins rejects non-existent userId with 404', async () => {
  const res = await fetch(`${baseUrl}/api/checkins`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: 'non-existent-user-12345',
      type: 'MOOD',
      status: 'Feeling great',
    }),
  })
  assert.equal(res.status, 404)
  const json = await res.json()
  assert.equal(json.success, false)
})

test('POST /api/alerts and PATCH /api/alerts/:id creates and resolves alert', async () => {
  const usersRes = await fetch(`${baseUrl}/api/users`)
  const { data: users } = await usersRes.json()
  const senior = users.find((u) => u.role === 'SENIOR')

  const createRes = await fetch(`${baseUrl}/api/alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: senior.id,
      type: 'SOS',
      status: 'ACTIVE',
    }),
  })
  assert.equal(createRes.status, 201)
  const { data: createdAlert } = await createRes.json()
  assert.equal(createdAlert.type, 'SOS')
  assert.equal(createdAlert.status, 'ACTIVE')

  const resolveRes = await fetch(`${baseUrl}/api/alerts/${createdAlert.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'RESOLVED',
    }),
  })
  assert.equal(resolveRes.status, 200)
  const { data: resolvedAlert } = await resolveRes.json()
  assert.equal(resolvedAlert.status, 'RESOLVED')
})

test('POST /api/alerts rejects invalid alert type with 400', async () => {
  const usersRes = await fetch(`${baseUrl}/api/users`)
  const { data: users } = await usersRes.json()
  const senior = users.find((u) => u.role === 'SENIOR')

  const res = await fetch(`${baseUrl}/api/alerts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: senior.id,
      type: 'INVALID_ALERT',
    }),
  })
  assert.equal(res.status, 400)
  const json = await res.json()
  assert.equal(json.success, false)
})

test('PATCH /api/alerts/:id rejects invalid status with 400', async () => {
  const res = await fetch(`${baseUrl}/api/alerts/some-id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'UNKNOWN_STATUS',
    }),
  })
  assert.equal(res.status, 400)
  const json = await res.json()
  assert.equal(json.success, false)
})

test('PATCH /api/alerts/:id returns 404 for non-existent alert', async () => {
  const res = await fetch(`${baseUrl}/api/alerts/non-existent-alert-id`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'RESOLVED',
    }),
  })
  assert.equal(res.status, 404)
  const json = await res.json()
  assert.equal(json.success, false)
})
