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
  await new Promise((resolve) => server.close(resolve))
  await prisma.$disconnect()
})

test('GET /health returns status ok', async () => {
  const res = await fetch(`${baseUrl}/health`)
  assert.equal(res.status, 200)
  const data = await res.json()
  assert.equal(data.status, 'ok')
  assert.equal(data.service, 'CareCircle API')
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
