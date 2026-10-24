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

test('POST /api/checkin normalizes case-insensitive type (e.g. Pills, meal) and trims status', async () => {
  const usersRes = await fetch(`${baseUrl}/api/users`)
  const { data: users } = await usersRes.json()
  const senior = users.find((u) => u.role === 'SENIOR')

  const res = await fetch(`${baseUrl}/api/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: senior.id,
      type: 'Pills',
      status: '   Evening dose taken with water   ',
    }),
  })
  assert.equal(res.status, 201)
  const json = await res.json()
  assert.equal(json.success, true)
  assert.equal(json.data.type, 'PILLS')
  assert.equal(json.data.status, 'Evening dose taken with water')

  const dbRecord = await prisma.checkIn.findUnique({
    where: { id: json.data.id },
  })
  assert.ok(dbRecord)
  assert.equal(dbRecord.type, 'PILLS')
  assert.equal(dbRecord.status, 'Evening dose taken with water')
})

test('POST /api/checkin rejects whitespace-only status with 400', async () => {
  const usersRes = await fetch(`${baseUrl}/api/users`)
  const { data: users } = await usersRes.json()
  const senior = users.find((u) => u.role === 'SENIOR')

  const res = await fetch(`${baseUrl}/api/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: senior.id,
      type: 'MEAL',
      status: '    ',
    }),
  })
  assert.equal(res.status, 400)
  const json = await res.json()
  assert.equal(json.success, false)
  assert.ok(json.error.includes('non-empty status'))
})

test('GET /api/checkins filters by familyGroupId and type', async () => {
  const res = await fetch(`${baseUrl}/api/checkins?familyGroupId=fam_group_carecircle_101&type=PILLS`)
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.success, true)
  assert.ok(json.data.length > 0)
  assert.ok(json.data.every((c) => c.type === 'PILLS' && c.user.familyGroupId === 'fam_group_carecircle_101'))
})

test('Socket.io client receives checkin:new when connecting via auth.familyGroupId', async () => {
  const usersRes = await fetch(`${baseUrl}/api/users`)
  const { data: users } = await usersRes.json()
  const senior = users.find((u) => u.role === 'SENIOR')

  const socketAuth = Client(baseUrl, {
    auth: { familyGroupId: senior.familyGroupId },
    transports: ['websocket'],
  })

  await new Promise((resolve) => socketAuth.on('connect', resolve))

  const eventPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for auth checkin:new event')), 4000)
    socketAuth.on('checkin:new', (payload) => {
      clearTimeout(timeout)
      resolve(payload)
    })
  })

  const res = await fetch(`${baseUrl}/api/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: senior.id,
      type: 'meal',
      status: 'Warm supper enjoyed',
    }),
  })
  assert.equal(res.status, 201)

  const received = await eventPromise
  assert.equal(received.type, 'MEAL')
  assert.equal(received.status, 'Warm supper enjoyed')

  socketAuth.disconnect()
})

test('GET /api/dashboard/:familyGroupId returns latest check-in status per senior and recent check-ins list', async () => {
  const usersRes = await fetch(`${baseUrl}/api/users`)
  const { data: users } = await usersRes.json()
  const senior = users.find((u) => u.role === 'SENIOR')

  // Post a fresh check-in to ensure a recent check-in exists
  await fetch(`${baseUrl}/api/checkin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: senior.id,
      type: 'MOOD',
      status: 'Feeling energetic and joyful',
    }),
  })

  const res = await fetch(`${baseUrl}/api/dashboard/${senior.familyGroupId}`)
  assert.equal(res.status, 200)
  const json = await res.json()

  assert.equal(json.success, true)
  assert.equal(json.data.familyGroupId, senior.familyGroupId)
  assert.ok(Array.isArray(json.data.seniors), 'seniors must be an array')
  assert.ok(json.data.seniors.length >= 1, 'at least 1 senior returned')

  const seniorData = json.data.seniors.find((s) => s.id === senior.id)
  assert.ok(seniorData, 'Senior Eleanor must be in dashboard seniors list')
  assert.equal(seniorData.name, senior.name)
  assert.equal(seniorData.role, 'SENIOR')
  assert.equal(seniorData.status, 'GREEN')
  assert.equal(seniorData.statusColor, 'green')
  assert.equal(seniorData.isCheckedInRecently, true)
  assert.ok(seniorData.latestCheckIn, 'latestCheckIn must exist')
  assert.equal(seniorData.latestCheckIn.type, 'MOOD')
  assert.equal(seniorData.latestCheckIn.status, 'Feeling energetic and joyful')
  assert.ok(seniorData.lastCheckInTime, 'lastCheckInTime must be defined')

  // Verify recentCheckIns list
  assert.ok(Array.isArray(json.data.recentCheckIns))
  assert.ok(json.data.recentCheckIns.length > 0)
  assert.equal(json.data.recentCheckIns[0].status, 'Feeling energetic and joyful')
})

test('GET /api/dashboard/:familyGroupId returns RED status when senior has no check-ins or overdue check-ins', async () => {
  const testGroupId = `test_fam_group_${Date.now()}`
  const overdueSenior = await prisma.user.create({
    data: {
      name: 'Overdue Senior Tester',
      role: 'SENIOR',
      phone: '+1-555-9999',
      familyGroupId: testGroupId,
    },
  })

  try {
    // 1. No check-ins at all -> status should be RED
    const resNoCheckins = await fetch(`${baseUrl}/api/dashboard/${testGroupId}`)
    assert.equal(resNoCheckins.status, 200)
    const jsonNoCheckins = await resNoCheckins.json()
    assert.equal(jsonNoCheckins.success, true)
    assert.equal(jsonNoCheckins.data.seniors.length, 1)
    const seniorItem = jsonNoCheckins.data.seniors[0]
    assert.equal(seniorItem.status, 'RED')
    assert.equal(seniorItem.statusColor, 'red')
    assert.equal(seniorItem.isCheckedInRecently, false)
    assert.equal(seniorItem.latestCheckIn, null)
    assert.equal(seniorItem.lastCheckInTime, null)

    // 2. Add an overdue check-in from 3 days ago (72 hours ago)
    const threeDaysAgo = new Date(Date.now() - 72 * 60 * 60 * 1000)
    await prisma.checkIn.create({
      data: {
        userId: overdueSenior.id,
        type: 'PILLS',
        status: 'Old medication from days ago',
        timestamp: threeDaysAgo,
      },
    })

    const resOldCheckin = await fetch(`${baseUrl}/api/dashboard/${testGroupId}`)
    const jsonOldCheckin = await resOldCheckin.json()
    const seniorItemOld = jsonOldCheckin.data.seniors[0]
    assert.equal(seniorItemOld.status, 'RED')
    assert.equal(seniorItemOld.statusColor, 'red')
    assert.equal(seniorItemOld.isCheckedInRecently, false)
    assert.ok(seniorItemOld.latestCheckIn)
    assert.equal(seniorItemOld.latestCheckIn.status, 'Old medication from days ago')

    // 3. Now add a fresh check-in today -> status turns GREEN
    await fetch(`${baseUrl}/api/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: overdueSenior.id,
        type: 'MEAL',
        status: 'Fresh warm meal just eaten',
      }),
    })

    const resFresh = await fetch(`${baseUrl}/api/dashboard/${testGroupId}`)
    const jsonFresh = await resFresh.json()
    const seniorItemFresh = jsonFresh.data.seniors[0]
    assert.equal(seniorItemFresh.status, 'GREEN')
    assert.equal(seniorItemFresh.statusColor, 'green')
    assert.equal(seniorItemFresh.isCheckedInRecently, true)
    assert.equal(seniorItemFresh.latestCheckIn.type, 'MEAL')
    assert.equal(seniorItemFresh.latestCheckIn.status, 'Fresh warm meal just eaten')
  } finally {
    await prisma.checkIn.deleteMany({ where: { userId: overdueSenior.id } })
    await prisma.user.delete({ where: { id: overdueSenior.id } })
  }
})

test('GET /api/dashboard/:familyGroupId supports ?limit= query parameter', async () => {
  const res = await fetch(`${baseUrl}/api/dashboard/fam_group_carecircle_101?limit=2`)
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.success, true)
  assert.ok(json.data.recentCheckIns.length <= 2)
})

test('GET /api/dashboard/:familyGroupId rejects whitespace-only familyGroupId with 400', async () => {
  const res = await fetch(`${baseUrl}/api/dashboard/%20%20%20`)
  assert.equal(res.status, 400)
  const json = await res.json()
  assert.equal(json.success, false)
  assert.ok(json.error.includes('familyGroupId'))
})

test('GET /api/dashboard/:familyGroupId returns empty list for unknown family group', async () => {
  const res = await fetch(`${baseUrl}/api/dashboard/non_existent_family_group_xyz`)
  assert.equal(res.status, 200)
  const json = await res.json()
  assert.equal(json.success, true)
  assert.equal(json.data.seniors.length, 0)
  assert.equal(json.data.recentCheckIns.length, 0)
})

test('GET /api/dashboard/:familyGroupId rejects non-positive or invalid ?limit= with 400', async () => {
  const resZero = await fetch(`${baseUrl}/api/dashboard/fam_group_carecircle_101?limit=0`)
  assert.equal(resZero.status, 400)
  const jsonZero = await resZero.json()
  assert.equal(jsonZero.success, false)

  const resNeg = await fetch(`${baseUrl}/api/dashboard/fam_group_carecircle_101?limit=-5`)
  assert.equal(resNeg.status, 400)
  const jsonNeg = await resNeg.json()
  assert.equal(jsonNeg.success, false)

  const resInvalid = await fetch(`${baseUrl}/api/dashboard/fam_group_carecircle_101?limit=abc`)
  assert.equal(resInvalid.status, 400)
  const jsonInvalid = await resInvalid.json()
  assert.equal(jsonInvalid.success, false)
})

test('GET /api/dashboard/:familyGroupId rejects non-positive or invalid ?thresholdHours= with 400', async () => {
  const resZero = await fetch(`${baseUrl}/api/dashboard/fam_group_carecircle_101?thresholdHours=0`)
  assert.equal(resZero.status, 400)
  const jsonZero = await resZero.json()
  assert.equal(jsonZero.success, false)

  const resNeg = await fetch(`${baseUrl}/api/dashboard/fam_group_carecircle_101?thresholdHours=-2`)
  assert.equal(resNeg.status, 400)
  const jsonNeg = await resNeg.json()
  assert.equal(jsonNeg.success, false)

  const resInvalid = await fetch(`${baseUrl}/api/dashboard/fam_group_carecircle_101?thresholdHours=notanumber`)
  assert.equal(resInvalid.status, 400)
  const jsonInvalid = await resInvalid.json()
  assert.equal(jsonInvalid.success, false)
})

test('GET /api/dashboard/:familyGroupId computes status accurately for multiple seniors in same group', async () => {
  const multiGroupId = `multi_senior_group_${Date.now()}`

  // Senior 1: has checked in recently (GREEN)
  const senior1 = await prisma.user.create({
    data: {
      name: 'Alice Active',
      role: 'SENIOR',
      phone: '+1-555-1001',
      familyGroupId: multiGroupId,
    },
  })
  await prisma.checkIn.create({
    data: {
      userId: senior1.id,
      type: 'MEAL',
      status: 'Ate lunch 30 minutes ago',
      timestamp: new Date(),
    },
  })

  // Senior 2: has overdue check-in from 4 days ago (RED)
  const senior2 = await prisma.user.create({
    data: {
      name: 'Bob Overdue',
      role: 'SENIOR',
      phone: '+1-555-1002',
      familyGroupId: multiGroupId,
    },
  })
  await prisma.checkIn.create({
    data: {
      userId: senior2.id,
      type: 'PILLS',
      status: 'Took pills 4 days ago',
      timestamp: new Date(Date.now() - 96 * 60 * 60 * 1000),
    },
  })

  try {
    const res = await fetch(`${baseUrl}/api/dashboard/${multiGroupId}`)
    assert.equal(res.status, 200)
    const json = await res.json()
    assert.equal(json.success, true)
    assert.equal(json.data.seniors.length, 2)

    const s1 = json.data.seniors.find((s) => s.id === senior1.id)
    const s2 = json.data.seniors.find((s) => s.id === senior2.id)

    assert.ok(s1 && s2, 'Both seniors must be returned in the dashboard response')
    assert.equal(s1.status, 'GREEN', 'Senior 1 with fresh check-in must be GREEN')
    assert.equal(s1.statusColor, 'green')
    assert.equal(s2.status, 'RED', 'Senior 2 with 4-day-old check-in must be RED')
    assert.equal(s2.statusColor, 'red')

    // Since Senior 2 is RED, the family circle overall status must be RED to warn caregivers
    assert.equal(json.data.status, 'RED')
    assert.equal(json.data.statusColor, 'red')
  } finally {
    await prisma.checkIn.deleteMany({ where: { userId: { in: [senior1.id, senior2.id] } } })
    await prisma.user.deleteMany({ where: { id: { in: [senior1.id, senior2.id] } } })
  }
})



