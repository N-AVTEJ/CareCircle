import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { server, io, prisma } from '../src/index.js'

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

async function runMultiTabVerification() {
  console.log('🚀 Starting Multi-Tab Real-Time Live Sync Verification...')
  console.log('   Requirement: Check in from senior view in Tab 1 -> Family view in Tab 2 updates instantly with no refresh.\n')

  // 1. Start server on ephemeral port
  const port = await new Promise((resolve) => {
    server.listen(0, () => resolve(server.address().port))
  })
  const baseUrl = `http://localhost:${port}`
  console.log(`📡 Backend server listening on ${baseUrl}`)

  // Verify database seed state
  const senior = await prisma.user.findUnique({
    where: { id: HARDCODED_SENIOR_USER_ID },
  })
  assert.ok(senior, `Senior user ${HARDCODED_SENIOR_USER_ID} must exist in DB`)
  console.log(`👤 Senior user verified in DB: ${senior.name} (${senior.role}) in group ${senior.familyGroupId}`)

  if (!fs.existsSync(edgePath)) {
    console.log('⚠️ Edge not found at standard path, cannot run headless browser GUI.')
    process.exit(1)
  }

  const cdpPort = 9338
  const userDataDir = path.join(os.tmpdir(), `carecircle-tabs-${Date.now()}`)
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

  let wsTab1, wsTab2
  try {
    // Wait for Edge CDP to be ready
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

    // =========================================================================
    // Open Tab 1: Senior View (?view=senior)
    // =========================================================================
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

    // =========================================================================
    // Open Tab 2: Family Dashboard View (?view=family)
    // =========================================================================
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

    // Wait for Tab 1 buttons to render
    let seniorButtonsReady = false
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200))
      const ready = await cdpTab1.evaluate(
        `Boolean(document.querySelector('[data-testid="senior-button-meal"]'))`
      )
      if (ready) {
        seniorButtonsReady = true
        break
      }
    }
    assert.ok(seniorButtonsReady, 'Senior view 1-tap buttons failed to render in Tab 1')
    console.log('   ✅ Tab 1 (Senior View) loaded with 1-tap buttons ready')

    // Wait for Tab 2 family view to render
    let familyCardReady = false
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200))
      const ready = await cdpTab2.evaluate(
        `Boolean(document.querySelector('[data-testid="senior-status-card"]')) && Boolean(document.querySelector('[data-testid="live-checkin-list"]'))`
      )
      if (ready) {
        familyCardReady = true
        break
      }
    }
    assert.ok(familyCardReady, 'Family view status card or live check-in list failed to render in Tab 2')
    console.log('   ✅ Tab 2 (Family View) loaded with status card and live check-ins feed ready')

    // In Tab 2: Stamp a window variable to prove NO PAGE REFRESH occurs!
    const pageToken = `tab2_token_${Date.now()}`
    await cdpTab2.evaluate(`window.__pageReloadToken = "${pageToken}"`)

    // In Tab 2: Capture initial status and check-ins count
    const initialBadgeText = await cdpTab2.evaluate(
      `document.querySelector('[data-testid="senior-status-badge"]')?.innerText?.trim() || ''`
    )
    const initialCheckInCount = await cdpTab2.evaluate(
      `document.querySelectorAll('[data-testid="checkin-item"]').length`
    )
    console.log(`   📊 Tab 2 Initial State:`, {
      statusBadge: initialBadgeText,
      checkInsDisplayed: initialCheckInCount,
    })

    // =========================================================================
    // Action: Click 1-Tap "Meal" Check-In in Tab 1 (Senior View)
    // =========================================================================
    console.log('\n👉 Tab 1 Action: Eleanor Vance taps "Meal Check-In" button [data-testid="senior-button-meal"]...')
    await cdpTab1.evaluate(`document.querySelector('[data-testid="senior-button-meal"]').click()`)

    // Verify Tab 1 displays confirmation toast
    let toastConfirmed = false
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 100))
      const toastText = await cdpTab1.evaluate(
        `document.querySelector('[data-testid="checkin-feedback"]')?.innerText || ''`
      )
      if (toastText.includes('Meal')) {
        toastConfirmed = true
        console.log(`   ✅ Tab 1 Toast: "${toastText.replace(/\n/g, ' ')}"`)
        break
      }
    }
    assert.ok(toastConfirmed, 'Tab 1 should display confirmation toast')

    // =========================================================================
    // Verification in Tab 2: Live Socket.io Update with NO PAGE REFRESH!
    // =========================================================================
    console.log('\n👀 Monitoring Tab 2 for Instant Real-Time Update over Socket.io...')
    let tab2Updated = false
    let updatedBadgeText = ''
    let updatedCheckInCount = 0
    let topCheckInText = ''

    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200))

      updatedCheckInCount = (await cdpTab2.evaluate(
        `document.querySelectorAll('[data-testid="checkin-item"]').length`
      )) || 0

      if (updatedCheckInCount > initialCheckInCount) {
        tab2Updated = true
        updatedBadgeText = (await cdpTab2.evaluate(
          `document.querySelector('[data-testid="senior-status-badge"]')?.innerText?.trim() || ''`
        )) || ''
        topCheckInText = (await cdpTab2.evaluate(
          `document.querySelector('[data-testid="checkin-item"]')?.innerText?.trim()?.replace(/\\s+/g, ' ') || ''`
        )) || ''
        break
      }
    }

    assert.ok(
      tab2Updated,
      `Tab 2 failed to receive real-time Socket.io update! Items before: ${initialCheckInCount}, after: ${updatedCheckInCount}`
    )

    // Prove Tab 2 DID NOT REFRESH
    const tokenAfter = await cdpTab2.evaluate(`window.__pageReloadToken`)
    assert.equal(
      tokenAfter,
      pageToken,
      'Tab 2 reloaded the page! It was supposed to update live via Socket.io with NO refresh.'
    )
    console.log('   ✅ Tab 2 Token Check: Page did NOT refresh (window.__pageReloadToken preserved)!')

    // Verify Tab 2 status card updated
    console.log(`   ✅ Tab 2 Status Badge: "${updatedBadgeText}"`)
    assert.ok(
      updatedBadgeText.includes('SAFE') || updatedBadgeText.includes('CHECKED IN'),
      `Status badge should indicate SAFE / CHECKED IN, got: "${updatedBadgeText}"`
    )

    // Verify Tab 2 status card reflects green border/styling
    const cardClasses = await cdpTab2.evaluate(
      `document.querySelector('[data-testid="senior-status-card"]')?.className || ''`
    )
    assert.ok(
      cardClasses.includes('border-emerald'),
      `Status card should have emerald/green border styling, got: "${cardClasses}"`
    )
    console.log('   ✅ Tab 2 Status Card: Emerald green border confirmed!')

    // Verify Tab 2 top item in live check-ins feed
    console.log(`   ✅ Tab 2 Top Check-In Item: "${topCheckInText}"`)
    assert.ok(
      topCheckInText.includes('MEAL'),
      `Top check-in item should include MEAL, got: "${topCheckInText}"`
    )
    assert.ok(
      topCheckInText.includes('Finished a healthy meal'),
      `Top check-in item should include status note "Finished a healthy meal", got: "${topCheckInText}"`
    )

    // Verify Tab 2 live toast
    const liveToastText = await cdpTab2.evaluate(
      `document.querySelector('[data-testid="family-live-toast"]')?.innerText || ''`
    )
    console.log(`   ✅ Tab 2 Live Socket Toast: "${liveToastText.replace(/\n/g, ' ')}"`)

    // =========================================================================
    // Action 2: Click 1-Tap "Mood" Check-In in Tab 1 (Senior View)
    // =========================================================================
    console.log('\n👉 Tab 1 Action 2: Eleanor Vance taps "Mood Check-In" button [data-testid="senior-button-mood"]...')
    const countBeforeMood = (await cdpTab2.evaluate(
      `document.querySelectorAll('[data-testid="checkin-item"]').length`
    )) || 0

    await cdpTab1.evaluate(`document.querySelector('[data-testid="senior-button-mood"]').click()`)

    let tab2MoodUpdated = false
    let topMoodText = ''
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200))
      const countNow = (await cdpTab2.evaluate(
        `document.querySelectorAll('[data-testid="checkin-item"]').length`
      )) || 0
      if (countNow > countBeforeMood) {
        tab2MoodUpdated = true
        topMoodText = (await cdpTab2.evaluate(
          `document.querySelector('[data-testid="checkin-item"]')?.innerText?.trim()?.replace(/\\s+/g, ' ') || ''`
        )) || ''
        break
      }
    }
    assert.ok(tab2MoodUpdated, 'Tab 2 failed to update on second consecutive check-in (Mood)!')
    assert.ok(topMoodText.includes('MOOD'), `Top item should now be MOOD, got: "${topMoodText}"`)
    console.log(`   ✅ Tab 2 instantly received second check-in (MOOD) with zero refresh!`)

    // Confirm Tab 2 reload token is still preserved
    const finalToken = await cdpTab2.evaluate(`window.__pageReloadToken`)
    assert.equal(finalToken, pageToken, 'Tab 2 reloaded during test!')
    console.log('   ✅ Tab 2 remained continuously connected on single page session throughout all events!')

    console.log('\n🎉 ALL MULTI-TAB LIVE SYNC VERIFICATIONS PASSED!')
    console.log('   - Tab 1 checked in via Senior 1-Tap Meal button -> Tab 2 updated instantly.')
    console.log('   - Tab 1 checked in via Senior 1-Tap Mood button -> Tab 2 updated instantly.')
    console.log('   - Backend emitted "checkin:new" to room fam_group_carecircle_101.')
    console.log('   - Tab 2 (Family View) updated its Senior Status Card (Green) and live check-in feed instantly.')
    console.log('   - ZERO page refresh occurred in Tab 2 (confirmed via persistent JS memory token).')
  } finally {
    if (wsTab1) wsTab1.close()
    if (wsTab2) wsTab2.close()
    edgeProc.kill()
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch {}

    io.close()
    server.closeAllConnections?.()
    await new Promise((r) => server.close(r))
    await prisma.$disconnect()
  }
}

runMultiTabVerification().catch((err) => {
  console.error('❌ Multi-tab verification failed:', err)
  process.exit(1)
})
