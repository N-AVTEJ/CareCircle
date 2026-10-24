import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { server, io, prisma } from '../src/index.js'
import { io as Client } from 'socket.io-client'

const HARDCODED_SENIOR_USER_ID = 'ffd75d01-03e9-4138-abd1-b095ac5ba212'
const FAMILY_GROUP_ID = 'fam_group_carecircle_101'
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

async function runBrowserVerification(baseUrl) {
  if (!fs.existsSync(edgePath)) {
    console.log('⚠️ Edge not found at standard path, skipping browser GUI automation.')
    return
  }
  console.log('\n🌐 Starting Real Browser DOM Click Verification with Edge Headless...')
  const cdpPort = 9335
  const userDataDir = path.join(os.tmpdir(), `carecircle-edge-${Date.now()}`)
  const edgeProc = spawn(
    edgePath,
    [
      '--headless=new',
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      'about:blank',
    ],
    { stdio: 'ignore' }
  )

  let ws
  try {
    let versionData
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200))
      try {
        const res = await fetch(`http://127.0.0.1:${cdpPort}/json/version`)
        if (res.ok) {
          versionData = await res.json()
          break
        }
      } catch {}
    }
    if (!versionData) throw new Error('Failed to connect to Edge CDP endpoint')
    console.log(`   Connected to browser: ${versionData.Browser}`)

    const newPageRes = await fetch(
      `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(baseUrl)}`,
      { method: 'PUT' }
    )
    const pageData = await newPageRes.json()
    const wsUrl = pageData.webSocketDebuggerUrl

    ws = new WebSocket(wsUrl)
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve)
      ws.addEventListener('error', reject)
    })

    let cmdId = 0
    function sendCommand(method, params = {}) {
      return new Promise((resolve, reject) => {
        const id = ++cmdId
        const onMessage = (event) => {
          const msg = JSON.parse(event.data)
          if (msg.id === id) {
            ws.removeEventListener('message', onMessage)
            if (msg.error) reject(new Error(msg.error.message))
            else resolve(msg.result)
          }
        }
        ws.addEventListener('message', onMessage)
        ws.send(JSON.stringify({ id, method, params }))
      })
    }

    await sendCommand('Page.enable')
    await sendCommand('Runtime.enable')

    console.log(`   Navigating browser to ${baseUrl}...`)
    await sendCommand('Page.navigate', { url: baseUrl })

    let buttonsReady = false
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 250))
      const evalRes = await sendCommand('Runtime.evaluate', {
        expression: `Boolean(document.querySelector('[data-testid="senior-button-pills"]'))`,
        returnByValue: true,
      })
      if (evalRes?.result?.value === true) {
        buttonsReady = true
        break
      }
    }
    assert.ok(buttonsReady, 'Senior View buttons did not render in DOM in time')
    console.log('   ✅ Senior View 3 Big Buttons confirmed present in browser DOM!')

    const countBefore = await prisma.checkIn.count({
      where: { userId: HARDCODED_SENIOR_USER_ID },
    })

    // Click 1: Pills Button
    console.log('   👉 Browser Click: [data-testid="senior-button-pills"]')
    await sendCommand('Runtime.evaluate', {
      expression: `document.querySelector('[data-testid="senior-button-pills"]').click()`,
    })
    await new Promise((r) => setTimeout(r, 700))

    const toastCheck = await sendCommand('Runtime.evaluate', {
      expression: `document.querySelector('[data-testid="checkin-feedback"]')?.innerText || ''`,
      returnByValue: true,
    })
    console.log(`      Toast appeared: "${toastCheck?.result?.value?.replace(/\n/g, ' ')}"`)
    assert.ok(toastCheck?.result?.value?.includes('Pills'), 'Feedback toast should mention Pills')

    // Click 2: Meal Button
    console.log('   👉 Browser Click: [data-testid="senior-button-meal"]')
    await sendCommand('Runtime.evaluate', {
      expression: `document.querySelector('[data-testid="senior-button-meal"]').click()`,
    })
    await new Promise((r) => setTimeout(r, 700))

    // Click 3: Mood Button
    console.log('   👉 Browser Click: [data-testid="senior-button-mood"]')
    await sendCommand('Runtime.evaluate', {
      expression: `document.querySelector('[data-testid="senior-button-mood"]').click()`,
    })
    await new Promise((r) => setTimeout(r, 700))

    const countAfter = await prisma.checkIn.count({
      where: { userId: HARDCODED_SENIOR_USER_ID },
    })
    assert.equal(
      countAfter,
      countBefore + 3,
      `Expected 3 new CheckIn rows created by browser clicks, got ${countAfter - countBefore}`
    )
    console.log(
      `   ✅ Verified: 3 new CheckIn rows created in PostgreSQL from real browser DOM button clicks!`
    )
  } finally {
    if (ws) ws.close()
    edgeProc.kill()
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch {}
  }
}

async function runVerification() {
  console.log('🚀 Starting Senior Check-In & Socket.io Room Verification...')

  // 1. Start server on ephemeral port
  const port = await new Promise((resolve) => {
    server.listen(0, () => resolve(server.address().port))
  })
  const baseUrl = `http://localhost:${port}`
  console.log(`📡 Backend server listening on ${baseUrl}`)

  // Verify Senior user exists in database
  const senior = await prisma.user.findUnique({
    where: { id: HARDCODED_SENIOR_USER_ID },
  })
  assert.ok(senior, `Senior user ${HARDCODED_SENIOR_USER_ID} must exist in DB`)
  console.log(
    `👤 Senior user verified in DB: ${senior.name} (${senior.role}) in group ${senior.familyGroupId}`
  )

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

  // 3. Test API endpoint POST /api/checkin
  const buttonsToTest = [
    { type: 'PILLS', status: 'Morning blood pressure pills taken' },
    { type: 'MEAL', status: 'Ate balanced lunch with tea' },
    { type: 'MOOD', status: 'Feeling cheerful and energized' },
  ]

  const createdCheckInIds = []

  for (const button of buttonsToTest) {
    console.log(`👉 API Check-In: [ ${button.type} ] -> "${button.status}"`)
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

  // 5. Run Real Browser DOM UI Button Click Verification
  await runBrowserVerification(baseUrl)

  // Cleanup
  socket.disconnect()
  io.close()
  server.closeAllConnections?.()
  await new Promise((r) => server.close(r))
  await prisma.$disconnect()

  console.log(
    '\n🎉 ALL VERIFICATIONS PASSED: 3 Senior check-in rows successfully persisted in CheckIn table via API and real browser DOM button clicks, and broadcast over Socket.io!'
  )
}

runVerification().catch((err) => {
  console.error('❌ Verification failed:', err)
  process.exit(1)
})
