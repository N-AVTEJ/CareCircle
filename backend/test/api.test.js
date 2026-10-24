import test from 'node:test'
import assert from 'node:assert/strict'
import { app, prisma } from '../src/index.js'

let server
let baseUrl

test.before(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, () => {
      const port = server.address().port
      baseUrl = `http://localhost:${port}`
      resolve()
    })
  })
})

test.after(async () => {
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
