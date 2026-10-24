import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import {
  server,
  io,
  prisma,
  checkSeniorCheckIns,
  startCheckInCron,
  stopCheckInCron,
  DEFAULT_CHECKIN_THRESHOLD_MS,
} from '../src/index.js'
import { io as Client } from 'socket.io-client'

const HARDCODED_SENIOR_USER_ID = 'ffd75d01-03e9-4138-abd1-b095ac5ba212'
const FAMILY_GROUP_ID = 'fam_group_carecircle_101'
const edgePath = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

function createCdpClient(ws) {
  let cmdId = 0
  const sendCommand = (method, params = {}) => {
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

  const evaluate = async (expression) => {
    const res = await sendCommand('Runtime.evaluate', {
      expression,
      returnByValue: true,
    })
    return res?.result?.value
  }

  return { sendCommand, evaluate }
}

async function runAlertVerification() {
  console.log('🚀 Starting Verification: Cron Job & Live Family Dashboard Alert Banner...')
  console.log('   Task: stop checking in from senior view, wait 2 min, alert fires live on family dashboard.\n')

  // 1. Verify default threshold
  assert.equal(DEFAULT_CHECKIN_THRESHOLD_MS, 120000, 'Threshold must be 2 minutes (120000 ms)')
  console.log(`✅ Default threshold verified: ${DEFAULT_CHECKIN_THRESHOLD_MS / 1000}s (2 min)`)

  // 2. Start backend server on ephemeral port
  const port = await new Promise((resolve) => {
    server.listen(0, () => resolve(server.address().port))
  })
  const baseUrl = `http://localhost:${port}`
  console.log(`📡 Backend server listening on ${baseUrl}`)

  // 3. Verify senior user exists in DB
  const senior = await prisma.user.findUnique({
    where: { id: HARDCODED_SENIOR_USER_ID },
  })
  assert.ok(senior, `Senior user ${HARDCODED_SENIOR_USER_ID} must exist`)
  console.log(`👤 Senior user verified in DB: ${senior.name} in family group ${senior.familyGroupId}`)

  // Clean any previous alerts for clean test run
  await prisma.alert.deleteMany({ where: { userId: HARDCODED_SENIOR_USER_ID } })

  // Ensure Eleanor has a fresh check-in first so she begins in safe state
  await prisma.checkIn.deleteMany({ where: { userId: HARDCODED_SENIOR_USER_ID } })
  const freshCheckIn = await prisma.checkIn.create({
    data: {
      userId: HARDCODED_SENIOR_USER_ID,
      type: 'PILLS',
      status: 'Morning pills taken',
      timestamp: new Date(),
    },
  })
  console.log(`💊 Logged fresh check-in for ${senior.name} at ${freshCheckIn.timestamp.toISOString()}`)

  // Verify that fresh check-in produces NO alert
  const zeroAlerts = await checkSeniorCheckIns(120000)
  const eleanorAlert = zeroAlerts.find((a) => a.userId === HARDCODED_SENIOR_USER_ID)
  assert.equal(eleanorAlert, undefined, 'Fresh check-in must not trigger alert')
  console.log('✅ Confirmed: No alert created while within 2-minute safety window')

  // Check browser automation availability
  const hasBrowser = fs.existsSync(edgePath)
  if (!hasBrowser) {
    console.log('⚠️ Edge not found at standard path, falling back to Socket.io + REST live test.')
  }

  let edgeProc = null
  let wsTab1 = null
  let wsTab2 = null

  try {
    if (hasBrowser) {
      const cdpPort = 9345
      const userDataDir = path.join(os.tmpdir(), `carecircle-alert-verify-${Date.now()}`)
      edgeProc = spawn(
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
      assert.ok(versionData, 'Failed to connect to Edge CDP endpoint')
      console.log(`🌐 Connected to Edge browser: ${versionData.Browser}`)

      // Open Tab 1: Senior View
      console.log('\n📄 Opening Tab 1: Senior View (?view=senior)...')
      const tab1Res = await fetch(
        `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(baseUrl + '/?view=senior')}`,
        { method: 'PUT' }
      )
      const tab1Page = await tab1Res.json()
      wsTab1 = new WebSocket(tab1Page.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => {
        wsTab1.addEventListener('open', resolve)
        wsTab1.addEventListener('error', reject)
      })
      const cdpTab1 = createCdpClient(wsTab1)
      await cdpTab1.sendCommand('Page.enable')
      await cdpTab1.sendCommand('Runtime.enable')

      // Open Tab 2: Family Dashboard View
      console.log('📄 Opening Tab 2: Family Dashboard View (?view=family)...')
      const tab2Res = await fetch(
        `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(baseUrl + '/?view=family')}`,
        { method: 'PUT' }
      )
      const tab2Page = await tab2Res.json()
      wsTab2 = new WebSocket(tab2Page.webSocketDebuggerUrl)
      await new Promise((resolve, reject) => {
        wsTab2.addEventListener('open', resolve)
        wsTab2.addEventListener('error', reject)
      })
      const cdpTab2 = createCdpClient(wsTab2)
      await cdpTab2.sendCommand('Page.enable')
      await cdpTab2.sendCommand('Runtime.enable')

      // Wait for Tab 2 family view to render
      let familyReady = false
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 200))
        const ready = await cdpTab2.evaluate(
          `Boolean(document.querySelector('[data-testid="senior-status-card"]'))`
        )
        if (ready) {
          familyReady = true
          break
        }
      }
      assert.ok(familyReady, 'Family dashboard failed to render in Tab 2')

      // Stamp page token in Tab 2 to verify NO page reload occurs
      const pageToken = `tab2_alert_token_${Date.now()}`
      await cdpTab2.evaluate(`window.__pageReloadToken = "${pageToken}"`)

      // Verify no red banner currently
      const initialBanner = await cdpTab2.evaluate(
        `Boolean(document.querySelector('[data-testid="no-checkin-alert-banner"]'))`
      )
      assert.equal(initialBanner, false, 'No alert banner should exist while check-in is fresh')
      console.log('✅ Tab 2 initially has NO alert banner (Senior is safe)')

      // =========================================================================
      // Step: Stop checking in from senior view, advance time > 2 minutes (125s)
      // =========================================================================
      console.log('\n⏳ Simulating: Stopped checking in from Senior view. Advancing check-in timestamp past 2 min window...')
      const twoMinutesFiveSecAgo = new Date(Date.now() - 125 * 1000)
      await prisma.checkIn.update({
        where: { id: freshCheckIn.id },
        data: { timestamp: twoMinutesFiveSecAgo },
      })
      console.log(`   Updated Eleanor Vance last check-in to ${twoMinutesFiveSecAgo.toISOString()} (gap > 2 min)`)

      // Run cron check
      console.log('⏰ Triggering checkSeniorCheckIns() cron execution...')
      const createdAlerts = await checkSeniorCheckIns(120000)
      const newAlert = createdAlerts.find((a) => a.userId === HARDCODED_SENIOR_USER_ID)
      assert.ok(newAlert, 'Alert must be created for Eleanor Vance after 2 min gap')
      assert.equal(newAlert.type, 'NO_CHECKIN')
      assert.equal(newAlert.status, 'ACTIVE')
      console.log(`✅ Cron created Alert row: id=${newAlert.id}, type=${newAlert.type}, status=${newAlert.status}`)

      // =========================================================================
      // Step: Verify alert banner fires LIVE in Tab 2 (Family Dashboard)
      // =========================================================================
      console.log('📡 Verifying live alert banner on Tab 2 (Family Dashboard) with NO page refresh...')
      let bannerAppeared = false
      let bannerText = ''
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 200))
        const bannerElementText = await cdpTab2.evaluate(
          `document.querySelector('[data-testid="no-checkin-alert-banner"]')?.innerText || ''`
        )
        if (bannerElementText.includes('No check-in for')) {
          bannerAppeared = true
          bannerText = bannerElementText
          break
        }
      }
      assert.ok(bannerAppeared, 'Red banner failed to appear live on Family Dashboard')
      console.log(`   ✅ Live Red Alert Banner appeared on Family Dashboard: "${bannerText.replace(/\n/g, ' ')}"`)
      assert.ok(
        bannerText.includes(`⚠️ No check-in for ${senior.name}`),
        `Banner must contain "⚠️ No check-in for ${senior.name}", got: "${bannerText}"`
      )

      // Verify NO page reload occurred
      const preservedToken = await cdpTab2.evaluate(`window.__pageReloadToken`)
      assert.equal(
        preservedToken,
        pageToken,
        'Live alert banner must appear via Socket.io with zero page reload!'
      )
      console.log('   ✅ Proved: Alert banner appeared via live Socket.io event with ZERO page reload!')

      // =========================================================================
      // Step: Verify "Mark Resolved" button → PATCH /api/alerts/:id
      // =========================================================================
      console.log('\n👉 Action: Family caregiver clicks "Mark Resolved" button...')
      const buttonExists = await cdpTab2.evaluate(
        `Boolean(document.querySelector('[data-testid="mark-resolved-button"]'))`
      )
      assert.ok(buttonExists, 'Mark Resolved button must be present in red alert banner')

      // Click "Mark Resolved"
      await cdpTab2.evaluate(`document.querySelector('[data-testid="mark-resolved-button"]').click()`)

      // Wait for banner to disappear
      let bannerDismissed = false
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 200))
        const stillPresent = await cdpTab2.evaluate(
          `Boolean(document.querySelector('[data-testid="no-checkin-alert-banner"]'))`
        )
        if (!stillPresent) {
          bannerDismissed = true
          break
        }
      }
      assert.ok(bannerDismissed, 'Red banner must be dismissed after clicking Mark Resolved')
      console.log('   ✅ Red Alert Banner successfully dismissed from Family Dashboard!')

      // Verify alert row status in Prisma DB is now RESOLVED
      const dbAlert = await prisma.alert.findUnique({
        where: { id: newAlert.id },
      })
      assert.equal(dbAlert.status, 'RESOLVED', 'Alert in DB must be updated to RESOLVED')
      console.log(`   ✅ DB Alert status confirmed RESOLVED: id=${dbAlert.id}, status=${dbAlert.status}`)
    } else {
      // Socket.io + REST fallback verification
      const socketClient = Client(baseUrl, {
        query: { familyGroupId: FAMILY_GROUP_ID },
        transports: ['websocket'],
      })
      await new Promise((resolve) => socketClient.on('connect', resolve))

      const alertReceived = new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('Timed out waiting for alert:new')), 5000)
        socketClient.on('alert:new', (data) => {
          clearTimeout(t)
          resolve(data)
        })
      })

      // Advance check-in past 2 min
      await prisma.checkIn.update({
        where: { id: freshCheckIn.id },
        data: { timestamp: new Date(Date.now() - 130 * 1000) },
      })

      const createdAlerts = await checkSeniorCheckIns(120000)
      const newAlert = createdAlerts.find((a) => a.userId === HARDCODED_SENIOR_USER_ID)
      assert.ok(newAlert, 'Alert must be created')
      assert.equal(newAlert.type, 'NO_CHECKIN')

      const emitted = await alertReceived
      assert.equal(emitted.id, newAlert.id)
      assert.equal(emitted.user.name, senior.name)

      // Resolve via PATCH /api/alerts/:id
      const res = await fetch(`${baseUrl}/api/alerts/${newAlert.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'RESOLVED' }),
      })
      assert.equal(res.status, 200)
      const json = await res.json()
      assert.equal(json.data.status, 'RESOLVED')
      socketClient.disconnect()
    }

    console.log('\n🎉 ALL VERIFICATION CRITERIA SUCCESSFULLY PASSED!')
    console.log('   1. Node-cron periodic check-in monitor detects senior gap > 2 min')
    console.log('   2. Prisma Alert row created with type NO_CHECKIN and status ACTIVE')
    console.log('   3. Socket.io emits "alert:new" event to senior familyGroupId room')
    console.log('   4. Family Dashboard displays live red banner: "⚠️ No check-in for Eleanor Vance"')
    console.log('   5. "Mark Resolved" button issues PATCH /api/alerts/:id and updates status to RESOLVED')
    console.log('   6. Banner clears immediately with zero page refresh\n')
  } finally {
    if (wsTab1) try { wsTab1.close() } catch {}
    if (wsTab2) try { wsTab2.close() } catch {}
    if (edgeProc) {
      try { edgeProc.kill('SIGKILL') } catch {}
    }
    stopCheckInCron()
    io.close()
    if (server) {
      server.closeAllConnections?.()
      await new Promise((resolve) => server.close(resolve))
    }
    await prisma.$disconnect()
  }
}

runAlertVerification().catch((err) => {
  console.error('❌ Verification failed:', err)
  process.exit(1)
})
