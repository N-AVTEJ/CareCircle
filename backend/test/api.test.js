import test from 'node:test'
import assert from 'node:assert/strict'
import {
  app,
  server,
  io,
  prisma,
  checkSeniorCheckIns,
  startCheckInCron,
  stopCheckInCron,
  DEFAULT_CHECKIN_THRESHOLD_MS,
  recordAlertResolution,
  clearAlertResolution,
  lastAlertResolutionTime,
} from '../src/index.js'
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
  stopCheckInCron()
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

  // Clear any active alerts so senior can achieve GREEN safe status with fresh check-in
  await prisma.alert.deleteMany({ where: { userId: senior.id, status: 'ACTIVE' } })

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

test('DEFAULT_CHECKIN_THRESHOLD_MS defaults to 2 minutes for demo', () => {
  assert.equal(
    DEFAULT_CHECKIN_THRESHOLD_MS,
    2 * 60 * 1000,
    'Demo threshold must be exactly 2 minutes (120000ms)'
  )
})

test('checkSeniorCheckIns does not create alert when senior checked in within threshold', async () => {
  const testGroupId = `fresh_group_${Date.now()}`
  const senior = await prisma.user.create({
    data: {
      name: 'Fresh Senior',
      role: 'SENIOR',
      phone: '+1-555-2001',
      familyGroupId: testGroupId,
    },
  })
  // Check-in from 30 seconds ago (well within 2 min threshold)
  await prisma.checkIn.create({
    data: {
      userId: senior.id,
      type: 'MEAL',
      status: 'Ate healthy breakfast',
      timestamp: new Date(Date.now() - 30 * 1000),
    },
  })

  try {
    const createdAlerts = await checkSeniorCheckIns(2 * 60 * 1000)
    const alertForSenior = createdAlerts.find((a) => a.userId === senior.id)
    assert.equal(alertForSenior, undefined, 'Fresh senior should not have an alert created')

    const dbAlerts = await prisma.alert.findMany({ where: { userId: senior.id } })
    assert.equal(dbAlerts.length, 0, 'No alert row should exist in DB for fresh senior')
  } finally {
    await prisma.checkIn.deleteMany({ where: { userId: senior.id } })
    await prisma.user.deleteMany({ where: { id: senior.id } })
  }
})

test('checkSeniorCheckIns creates NO_CHECKIN Alert and emits alert:new via Socket.io when gap > 2 min', async () => {
  const testGroupId = `overdue_group_${Date.now()}`
  const senior = await prisma.user.create({
    data: {
      name: 'Overdue Senior',
      role: 'SENIOR',
      phone: '+1-555-2002',
      familyGroupId: testGroupId,
    },
  })
  // Check-in from 3 minutes ago (gap > 2 min threshold)
  await prisma.checkIn.create({
    data: {
      userId: senior.id,
      type: 'PILLS',
      status: 'Took pills 3 minutes ago',
      timestamp: new Date(Date.now() - 3 * 60 * 1000),
    },
  })

  // Connect socket.io client to listen for 'alert:new' in that room
  const socketClient = Client(baseUrl, {
    query: { familyGroupId: testGroupId },
    transports: ['websocket'],
  })

  try {
    await new Promise((resolve) => socketClient.on('connect', resolve))

    const alertPromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for alert:new Socket.io event')),
        5000
      )
      socketClient.on('alert:new', (data) => {
        clearTimeout(timeout)
        resolve(data)
      })
    })

    // Run checkSeniorCheckIns with 2 min threshold
    const createdAlerts = await checkSeniorCheckIns(2 * 60 * 1000)
    const createdAlert = createdAlerts.find((a) => a.userId === senior.id)

    assert.ok(createdAlert, 'An alert must be created for the overdue senior')
    assert.equal(createdAlert.type, 'NO_CHECKIN')
    assert.equal(createdAlert.status, 'ACTIVE')
    assert.equal(createdAlert.userId, senior.id)

    // Verify row persisted in Prisma Alert table
    const dbAlert = await prisma.alert.findUnique({
      where: { id: createdAlert.id },
      include: { user: true },
    })
    assert.ok(dbAlert, 'Alert must be saved in database')
    assert.equal(dbAlert.type, 'NO_CHECKIN')
    assert.equal(dbAlert.status, 'ACTIVE')
    assert.equal(dbAlert.user.name, 'Overdue Senior')

    // Verify Socket.io event was received
    const emittedAlert = await alertPromise
    assert.equal(emittedAlert.id, createdAlert.id)
    assert.equal(emittedAlert.type, 'NO_CHECKIN')
    assert.equal(emittedAlert.status, 'ACTIVE')

    // Second checkSeniorCheckIns call must NOT duplicate the active alert
    const secondPassAlerts = await checkSeniorCheckIns(2 * 60 * 1000)
    const duplicate = secondPassAlerts.find((a) => a.userId === senior.id)
    assert.equal(duplicate, undefined, 'Must not create duplicate active alert for same senior')

    const allDbAlerts = await prisma.alert.findMany({ where: { userId: senior.id } })
    assert.equal(allDbAlerts.length, 1, 'Exactly one alert row must exist in DB')

    // Test PATCH /api/alerts/:id marks it RESOLVED and emits alert:resolved
    const resolvePromise = new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('Timed out waiting for alert:resolved Socket.io event')),
        5000
      )
      socketClient.on('alert:resolved', (data) => {
        clearTimeout(timeout)
        resolve(data)
      })
    })

    const patchRes = await fetch(`${baseUrl}/api/alerts/${createdAlert.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'RESOLVED' }),
    })
    assert.equal(patchRes.status, 200)
    const patchJson = await patchRes.json()
    assert.equal(patchJson.success, true)
    assert.equal(patchJson.data.status, 'RESOLVED')

    const resolvedEvent = await resolvePromise
    assert.equal(resolvedEvent.id, createdAlert.id)
    assert.equal(resolvedEvent.status, 'RESOLVED')
  } finally {
    socketClient.disconnect()
    await prisma.alert.deleteMany({ where: { userId: senior.id } })
    await prisma.checkIn.deleteMany({ where: { userId: senior.id } })
    await prisma.user.deleteMany({ where: { id: senior.id } })
  }
})

test('startCheckInCron schedules cron and stopCheckInCron cancels it', () => {
  const task = startCheckInCron('* * * * *', 2 * 60 * 1000)
  assert.ok(task, 'startCheckInCron must return scheduled task')
  stopCheckInCron()
})

test('GET /api/alerts rejects invalid ?status= with 400', async () => {
  const res = await fetch(`${baseUrl}/api/alerts?status=INVALID_STATUS`)
  assert.equal(res.status, 400)
  const json = await res.json()
  assert.equal(json.success, false)
  assert.ok(json.error.includes('Allowed statuses'))
})

test('GET /api/alerts filters by familyGroupId', async () => {
  const groupA = `test_alerts_group_a_${Date.now()}`
  const groupB = `test_alerts_group_b_${Date.now()}`

  const userA = await prisma.user.create({
    data: {
      name: 'User In Group A',
      role: 'SENIOR',
      phone: '+1-555-8001',
      familyGroupId: groupA,
    },
  })

  const userB = await prisma.user.create({
    data: {
      name: 'User In Group B',
      role: 'SENIOR',
      phone: '+1-555-8002',
      familyGroupId: groupB,
    },
  })

  const alertA = await prisma.alert.create({
    data: {
      userId: userA.id,
      type: 'NO_CHECKIN',
      status: 'ACTIVE',
    },
  })

  const alertB = await prisma.alert.create({
    data: {
      userId: userB.id,
      type: 'SOS',
      status: 'ACTIVE',
    },
  })

  try {
    const resA = await fetch(`${baseUrl}/api/alerts?familyGroupId=${groupA}`)
    assert.equal(resA.status, 200)
    const jsonA = await resA.json()
    assert.ok(jsonA.data.some((a) => a.id === alertA.id), 'Group A alerts must include alertA')
    assert.ok(!jsonA.data.some((a) => a.id === alertB.id), 'Group A alerts must NOT include alertB')

    const resB = await fetch(`${baseUrl}/api/alerts?familyGroupId=${groupB}`)
    assert.equal(resB.status, 200)
    const jsonB = await resB.json()
    assert.ok(jsonB.data.some((a) => a.id === alertB.id), 'Group B alerts must include alertB')
    assert.ok(!jsonB.data.some((a) => a.id === alertA.id), 'Group B alerts must NOT include alertA')
  } finally {
    await prisma.alert.deleteMany({ where: { id: { in: [alertA.id, alertB.id] } } })
    await prisma.user.deleteMany({ where: { id: { in: [userA.id, userB.id] } } })
  }
})

test('GET /api/dashboard/:familyGroupId returns RED status when senior has an active alert even with recent check-in, and transitions to GREEN when resolved', async () => {
  const testGroupId = `active_alert_group_${Date.now()}`
  const senior = await prisma.user.create({
    data: {
      name: 'Alert Senior With Checkin',
      role: 'SENIOR',
      phone: '+1-555-8101',
      familyGroupId: testGroupId,
    },
  })

  // Recent check-in from 10 seconds ago
  const freshCheckIn = await prisma.checkIn.create({
    data: {
      userId: senior.id,
      type: 'PILLS',
      status: 'Pills taken 10 seconds ago',
      timestamp: new Date(),
    },
  })

  // Active NO_CHECKIN alert
  const alert = await prisma.alert.create({
    data: {
      userId: senior.id,
      type: 'NO_CHECKIN',
      status: 'ACTIVE',
      timestamp: new Date(),
    },
  })

  try {
    // 1. Dashboard must report RED status because an active alert exists
    const resActive = await fetch(`${baseUrl}/api/dashboard/${testGroupId}`)
    assert.equal(resActive.status, 200)
    const jsonActive = await resActive.json()
    const seniorActive = jsonActive.data.seniors.find((s) => s.id === senior.id)
    assert.ok(seniorActive)
    assert.equal(seniorActive.status, 'RED', 'Senior status must be RED when active alert exists')
    assert.equal(seniorActive.statusColor, 'red')
    assert.equal(seniorActive.hasActiveAlerts, true)
    assert.equal(jsonActive.data.status, 'RED', 'Overall dashboard status must be RED')

    // 2. Mark alert RESOLVED via PATCH /api/alerts/:id
    const resPatch = await fetch(`${baseUrl}/api/alerts/${alert.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'RESOLVED' }),
    })
    assert.equal(resPatch.status, 200)

    // 3. Dashboard must now report GREEN status
    const resResolved = await fetch(`${baseUrl}/api/dashboard/${testGroupId}`)
    assert.equal(resResolved.status, 200)
    const jsonResolved = await resResolved.json()
    const seniorResolved = jsonResolved.data.seniors.find((s) => s.id === senior.id)
    assert.ok(seniorResolved)
    assert.equal(seniorResolved.status, 'GREEN', 'Senior status must transition to GREEN when alert is resolved')
    assert.equal(seniorResolved.statusColor, 'green')
    assert.equal(seniorResolved.hasActiveAlerts, false)
    assert.equal(jsonResolved.data.status, 'GREEN')
  } finally {
    await prisma.alert.deleteMany({ where: { userId: senior.id } })
    await prisma.checkIn.deleteMany({ where: { userId: senior.id } })
    await prisma.user.deleteMany({ where: { id: senior.id } })
  }
})

test('checkSeniorCheckIns respects post-resolution cooldown to prevent immediate duplicate alerts', async () => {
  const testGroupId = `cooldown_group_${Date.now()}`
  const senior = await prisma.user.create({
    data: {
      name: 'Cooldown Senior',
      role: 'SENIOR',
      phone: '+1-555-8201',
      familyGroupId: testGroupId,
    },
  })

  // Check-in from 3 minutes ago (gap > 2 min)
  await prisma.checkIn.create({
    data: {
      userId: senior.id,
      type: 'MEAL',
      status: 'Meal from 3 minutes ago',
      timestamp: new Date(Date.now() - 3 * 60 * 1000),
    },
  })

  try {
    // 1. First run creates alert
    const created = await checkSeniorCheckIns(2 * 60 * 1000)
    const alert = created.find((a) => a.userId === senior.id)
    assert.ok(alert, 'Alert must be created on first gap detection')

    // 2. Resolve alert
    const patchRes = await fetch(`${baseUrl}/api/alerts/${alert.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'RESOLVED' }),
    })
    assert.equal(patchRes.status, 200)

    // 3. Immediately run checkSeniorCheckIns again while gap > 2 min still holds
    const secondPass = await checkSeniorCheckIns(2 * 60 * 1000)
    const dupAlert = secondPass.find((a) => a.userId === senior.id)
    assert.equal(dupAlert, undefined, 'Must NOT immediately create new alert during post-resolution cooldown window')

    // 4. Log a fresh check-in and verify cooldown is cleared
    await fetch(`${baseUrl}/api/checkin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId: senior.id,
        type: 'PILLS',
        status: 'Fresh check-in',
      }),
    })
    assert.equal(lastAlertResolutionTime.has(senior.id), false, 'Cooldown tracking must be cleared on fresh checkin')
  } finally {
    clearAlertResolution(senior.id)
    await prisma.alert.deleteMany({ where: { userId: senior.id } })
    await prisma.checkIn.deleteMany({ where: { userId: senior.id } })
    await prisma.user.deleteMany({ where: { id: senior.id } })
  }
})

test('POST /api/sos creates SOS Alert with high priority, emits alert:sos immediately, and persists to DB', async () => {
  const usersRes = await fetch(`${baseUrl}/api/users`)
  const { data: users } = await usersRes.json()
  const senior = users.find((u) => u.role === 'SENIOR')

  // Set up socket listener for room
  const socketClient = Client(baseUrl, {
    query: { familyGroupId: senior.familyGroupId },
    transports: ['websocket'],
  })
  await new Promise((resolve) => socketClient.on('connect', resolve))

  const sosEventPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for alert:sos event')), 4000)
    socketClient.on('alert:sos', (payload) => {
      clearTimeout(timeout)
      resolve(payload)
    })
  })

  const newAlertEventPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for alert:new event')), 4000)
    socketClient.on('alert:new', (payload) => {
      clearTimeout(timeout)
      resolve(payload)
    })
  })

  const res = await fetch(`${baseUrl}/api/sos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: senior.id }),
  })
  assert.equal(res.status, 201)
  const json = await res.json()

  assert.equal(json.success, true)
  assert.equal(json.data.type, 'SOS')
  assert.equal(json.data.status, 'ACTIVE')
  assert.equal(json.data.priority, 'HIGH')
  assert.equal(json.data.userId, senior.id)
  assert.ok(json.data.user)
  assert.equal(json.data.user.name, senior.name)
  assert.equal(json.data.user.phone, senior.phone)

  // Verify Socket.io alert:sos received immediately
  const sosEvent = await sosEventPromise
  assert.equal(sosEvent.id, json.data.id)
  assert.equal(sosEvent.type, 'SOS')
  assert.equal(sosEvent.priority, 'HIGH')

  // Verify Socket.io alert:new also received
  const newAlertEvent = await newAlertEventPromise
  assert.equal(newAlertEvent.id, json.data.id)

  // Verify DB persistence
  const dbAlert = await prisma.alert.findUnique({
    where: { id: json.data.id },
  })
  assert.ok(dbAlert)
  assert.equal(dbAlert.type, 'SOS')
  assert.equal(dbAlert.status, 'ACTIVE')
  assert.equal(dbAlert.userId, senior.id)

  socketClient.disconnect()
  // Clean up created alert
  await prisma.alert.delete({ where: { id: json.data.id } })
})

test('POST /api/sos emits alert:sos only to the senior family group room and not unrelated rooms', async () => {
  const targetGroup = `target_group_${Date.now()}`
  const unrelatedGroup = `unrelated_group_${Date.now()}`

  const targetSenior = await prisma.user.create({
    data: {
      name: 'Target SOS Senior',
      role: 'SENIOR',
      phone: '+1-555-9001',
      familyGroupId: targetGroup,
    },
  })

  const targetSocket = Client(baseUrl, {
    query: { familyGroupId: targetGroup },
    transports: ['websocket'],
  })
  const unrelatedSocket = Client(baseUrl, {
    query: { familyGroupId: unrelatedGroup },
    transports: ['websocket'],
  })

  await Promise.all([
    new Promise((resolve) => targetSocket.on('connect', resolve)),
    new Promise((resolve) => unrelatedSocket.on('connect', resolve)),
  ])

  let unrelatedReceived = false
  unrelatedSocket.on('alert:sos', () => {
    unrelatedReceived = true
  })

  const targetReceivedPromise = new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting for target alert:sos')), 4000)
    targetSocket.on('alert:sos', (payload) => {
      clearTimeout(timeout)
      resolve(payload)
    })
  })

  const res = await fetch(`${baseUrl}/api/sos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: targetSenior.id }),
  })
  assert.equal(res.status, 201)
  const json = await res.json()

  const received = await targetReceivedPromise
  assert.equal(received.id, json.data.id)

  await new Promise((r) => setTimeout(r, 100))
  assert.equal(unrelatedReceived, false, 'Unrelated room must NOT receive the alert:sos event')

  targetSocket.disconnect()
  unrelatedSocket.disconnect()
  await prisma.alert.deleteMany({ where: { userId: targetSenior.id } })
  await prisma.user.delete({ where: { id: targetSenior.id } })
})

test('POST /api/sos rejects missing or empty userId with 400', async () => {
  const res1 = await fetch(`${baseUrl}/api/sos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  assert.equal(res1.status, 400)
  const json1 = await res1.json()
  assert.equal(json1.success, false)
  assert.ok(json1.error.includes('userId is required'))

  const res2 = await fetch(`${baseUrl}/api/sos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: '   ' }),
  })
  assert.equal(res2.status, 400)
  const json2 = await res2.json()
  assert.equal(json2.success, false)
})

test('POST /api/sos rejects non-existent userId with 404', async () => {
  const res = await fetch(`${baseUrl}/api/sos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId: 'non-existent-user-uuid-9999' }),
  })
  assert.equal(res.status, 404)
  const json = await res.json()
  assert.equal(json.success, false)
  assert.ok(json.error.includes('not found'))
})





