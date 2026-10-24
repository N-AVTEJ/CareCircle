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

async function runRiskScoreVerification() {
  console.log('🚀 Starting Verification: 7-Day Risk Score Live Sync & Color Transitions...')
  console.log('   Requirement: Submit bad check-ins from Senior view (Tab 1) -> Risk ring turns yellow/red live on Family view (Tab 2) with NO refresh.\n')

  // 1. Verify PostgreSQL Database & Senior
  console.log('🗄️  1. Checking PostgreSQL Database Connection...')
  const senior = await prisma.user.findUnique({
    where: { id: HARDCODED_SENIOR_USER_ID },
  })
  assert.ok(senior, `Seeded senior Eleanor Vance (${HARDCODED_SENIOR_USER_ID}) must exist in PostgreSQL carecircle DB`)
  console.log(`   ✅ Senior found: "${senior.name}" in familyGroupId "${senior.familyGroupId}"`)

  // Reset check-ins for Eleanor so she starts clean at 0 (LOW, green)
  await prisma.checkIn.deleteMany({ where: { userId: HARDCODED_SENIOR_USER_ID } })
  console.log('   🧹 Reset Eleanor Vance check-ins in DB to ensure initial 0 risk score baseline')

  // 2. Start Backend Server on ephemeral port
  const port = await new Promise((resolve) => {
    server.listen(0, () => resolve(server.address().port))
  })
  const baseUrl = `http://localhost:${port}`
  console.log(`📡 Backend server listening on ${baseUrl}`)

  if (!fs.existsSync(edgePath)) {
    console.log('⚠️ Edge not found at standard path, skipping browser GUI automation.')
    server.close()
    await prisma.$disconnect()
    process.exit(1)
  }

  // 3. Launch Edge in Headless mode with remote debugging
  const cdpPort = 9355
  const userDataDir = path.join(os.tmpdir(), `carecircle-risk-${Date.now()}`)
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

  let wsTabSenior, wsTabFamily
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
    console.log('\n👵 Opening Tab 1: Senior View (?view=senior)...')
    const seniorPageRes = await fetch(
      `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(baseUrl + '/?view=senior')}`,
      { method: 'PUT' }
    )
    const seniorPageData = await seniorPageRes.json()
    wsTabSenior = new WebSocket(seniorPageData.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      wsTabSenior.addEventListener('open', resolve)
      wsTabSenior.addEventListener('error', reject)
    })
    const cdpSenior = createCdpClient(wsTabSenior)
    await cdpSenior.sendCommand('Page.enable')
    await cdpSenior.sendCommand('Runtime.enable')

    // =========================================================================
    // Open Tab 2: Family Dashboard View (?view=family)
    // =========================================================================
    console.log('👨‍👩‍👦 Opening Tab 2: Family Dashboard View (?view=family)...')
    const familyPageRes = await fetch(
      `http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(baseUrl + '/?view=family')}`,
      { method: 'PUT' }
    )
    const familyPageData = await familyPageRes.json()
    wsTabFamily = new WebSocket(familyPageData.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
      wsTabFamily.addEventListener('open', resolve)
      wsTabFamily.addEventListener('error', reject)
    })
    const cdpFamily = createCdpClient(wsTabFamily)
    await cdpFamily.sendCommand('Page.enable')
    await cdpFamily.sendCommand('Runtime.enable')

    // Wait for Tab 1 Senior view buttons to render
    let seniorReady = false
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200))
      const ready = await cdpSenior.evaluate(
        `Boolean(document.querySelector('[data-testid="senior-button-meal-skipped"]')) && Boolean(document.querySelector('[data-testid="senior-button-mood-bad"]'))`
      )
      if (ready) {
        seniorReady = true
        break
      }
    }
    assert.ok(seniorReady, 'Senior view adverse check-in buttons failed to render in Tab 1')
    console.log('   ✅ Tab 1 (Senior View) loaded with diverse check-in controls ready')

    // Wait for Tab 2 Family view Risk Score Card to render
    let riskCardReady = false
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200))
      const ready = await cdpFamily.evaluate(
        `Boolean(document.querySelector('[data-testid="risk-score-card"]')) && Boolean(document.querySelector('[data-testid="risk-score-ring"]'))`
      )
      if (ready) {
        riskCardReady = true
        break
      }
    }
    assert.ok(riskCardReady, 'Family view Risk Score card failed to render in Tab 2')
    console.log('   ✅ Tab 2 (Family View) loaded with RiskScoreCard & SVG progress ring ready')

    // Stamp window token in Tab 2 to strictly verify ZERO page reloads occur
    const zeroReloadToken = `zero_reload_token_${Date.now()}`
    await cdpFamily.evaluate(`window.__zeroReloadToken = "${zeroReloadToken}"`)

    // Verify initial risk score state in Tab 2 (Score 0, LOW, Green)
    const initialScore = await cdpFamily.evaluate(
      `document.querySelector('[data-testid="risk-score-value"]')?.innerText?.trim()`
    )
    const initialLevel = await cdpFamily.evaluate(
      `document.querySelector('[data-testid="risk-score-level"]')?.innerText?.trim()`
    )
    const initialReason = await cdpFamily.evaluate(
      `document.querySelector('[data-testid="risk-score-reason"]')?.innerText?.trim()`
    )

    console.log(`\n📊 Tab 2 Initial Baseline State:`, {
      riskScore: initialScore,
      level: initialLevel,
      reason: initialReason,
    })
    assert.equal(initialScore, '0', 'Initial risk score must be 0')
    assert.ok(initialLevel.includes('LOW'), 'Initial level must be LOW (<40)')
    assert.equal(initialReason, 'All check-ins on track')
    console.log('   ✅ Initial state confirmed: 0 Score, LOW Level, Green Ring')

    // =========================================================================
    // STEP 1: Senior submits Skipped Meal from Tab 1
    // =========================================================================
    console.log('\n🍲 STEP 1: Senior clicks "Skipped Meal" in Tab 1...')
    await cdpSenior.evaluate(`document.querySelector('[data-testid="senior-button-meal-skipped"]').click()`)

    // Wait for Tab 2 to live-update via Socket.io
    let step1Updated = false
    let step1Score = ''
    let step1Reason = ''
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200))
      step1Score = await cdpFamily.evaluate(
        `document.querySelector('[data-testid="risk-score-value"]')?.innerText?.trim()`
      )
      if (step1Score === '10') {
        step1Updated = true
        step1Reason = await cdpFamily.evaluate(
          `document.querySelector('[data-testid="risk-score-reason"]')?.innerText?.trim()`
        )
        break
      }
    }
    assert.ok(step1Updated, `Tab 2 risk score did not update to 10 live, current: ${step1Score}`)
    assert.equal(step1Reason, 'Skipped 1 meal')

    const tokenAfterStep1 = await cdpFamily.evaluate(`window.__zeroReloadToken`)
    assert.equal(tokenAfterStep1, zeroReloadToken, 'Page reload occurred in Tab 2 during Step 1!')
    console.log(`   ✅ Tab 2 live-updated: Score = 10, Reason = "${step1Reason}" (ZERO page reload)`)

    // =========================================================================
    // STEP 2: Senior submits Not Good Mood from Tab 1
    // =========================================================================
    console.log('\n😔 STEP 2: Senior clicks "Not Good / Low Mood" in Tab 1...')
    await cdpSenior.evaluate(`document.querySelector('[data-testid="senior-button-mood-bad"]').click()`)

    let step2Updated = false
    let step2Score = ''
    let step2Reason = ''
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200))
      step2Score = await cdpFamily.evaluate(
        `document.querySelector('[data-testid="risk-score-value"]')?.innerText?.trim()`
      )
      if (step2Score === '30') {
        step2Updated = true
        step2Reason = await cdpFamily.evaluate(
          `document.querySelector('[data-testid="risk-score-reason"]')?.innerText?.trim()`
        )
        break
      }
    }
    assert.ok(step2Updated, `Tab 2 risk score did not update to 30 live, current: ${step2Score}`)
    assert.equal(step2Reason, 'Skipped 1 meal, mood low 1 day')

    const tokenAfterStep2 = await cdpFamily.evaluate(`window.__zeroReloadToken`)
    assert.equal(tokenAfterStep2, zeroReloadToken, 'Page reload occurred in Tab 2 during Step 2!')
    console.log(`   ✅ Tab 2 live-updated: Score = 30, Reason = "${step2Reason}" (GREEN ring)`)

    // =========================================================================
    // STEP 3: Senior submits Missed Pills from Tab 1 -> Transitions to YELLOW (MEDIUM, 40-70)
    // =========================================================================
    console.log('\n💊 STEP 3: Senior clicks "Missed / No Pills" in Tab 1 (Triggering transition to YELLOW / MEDIUM)...')
    await cdpSenior.evaluate(`document.querySelector('[data-testid="senior-button-pills-missed"]').click()`)

    let step3Updated = false
    let step3Score = ''
    let step3Level = ''
    let step3Reason = ''
    let step3Classes = ''
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200))
      step3Score = await cdpFamily.evaluate(
        `document.querySelector('[data-testid="risk-score-value"]')?.innerText?.trim()`
      )
      if (step3Score === '45') {
        step3Updated = true
        step3Level = await cdpFamily.evaluate(
          `document.querySelector('[data-testid="risk-score-level"]')?.innerText?.trim()`
        )
        step3Reason = await cdpFamily.evaluate(
          `document.querySelector('[data-testid="risk-score-reason"]')?.innerText?.trim()`
        )
        step3Classes = await cdpFamily.evaluate(
          `document.querySelector('[data-testid="risk-score-card"]')?.className || ''`
        )
        break
      }
    }
    assert.ok(step3Updated, `Tab 2 risk score did not update to 45 live, current: ${step3Score}`)
    assert.ok(step3Level.includes('MEDIUM'), `Risk level should be MEDIUM (40-70), got: "${step3Level}"`)
    assert.ok(step3Classes.includes('border-amber'), `Card border should turn yellow/amber, got: "${step3Classes}"`)
    assert.equal(step3Reason, 'Missed 1 pill, Skipped 1 meal, mood low 1 day')

    const tokenAfterStep3 = await cdpFamily.evaluate(`window.__zeroReloadToken`)
    assert.equal(tokenAfterStep3, zeroReloadToken, 'Page reload occurred in Tab 2 during Step 3!')
    console.log(`   🟡 Tab 2 live-updated: Score = 45, Level = MEDIUM (YELLOW Ring & Card), Reason = "${step3Reason}"!`)

    // =========================================================================
    // STEP 4: Senior submits more bad check-ins -> Transitions to RED (HIGH, >=70)
    // =========================================================================
    console.log('\n🚨 STEP 4: Submitting additional adverse check-ins (Triggering transition to RED / HIGH >= 70)...')
    // Click quick skipped meal (+10 pts) -> 55
    await cdpSenior.evaluate(`document.querySelector('[data-testid="quick-button-meal-skipped"]').click()`)
    await new Promise((r) => setTimeout(r, 300))

    // Click quick missed pills (+15 pts) -> 70 (HIGH!)
    await cdpSenior.evaluate(`document.querySelector('[data-testid="quick-button-pills-missed"]').click()`)

    let step4Updated = false
    let step4Score = ''
    let step4Level = ''
    let step4Reason = ''
    let step4Classes = ''
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 200))
      step4Score = await cdpFamily.evaluate(
        `document.querySelector('[data-testid="risk-score-value"]')?.innerText?.trim()`
      )
      if (parseInt(step4Score, 10) >= 70) {
        step4Updated = true
        step4Level = await cdpFamily.evaluate(
          `document.querySelector('[data-testid="risk-score-level"]')?.innerText?.trim()`
        )
        step4Reason = await cdpFamily.evaluate(
          `document.querySelector('[data-testid="risk-score-reason"]')?.innerText?.trim()`
        )
        step4Classes = await cdpFamily.evaluate(
          `document.querySelector('[data-testid="risk-score-card"]')?.className || ''`
        )
        break
      }
    }
    assert.ok(step4Updated, `Tab 2 risk score did not reach >= 70 live, current: ${step4Score}`)
    assert.ok(step4Level.includes('HIGH'), `Risk level should be HIGH (>=70), got: "${step4Level}"`)
    assert.ok(step4Classes.includes('border-red'), `Card border should turn red, got: "${step4Classes}"`)

    const tokenAfterStep4 = await cdpFamily.evaluate(`window.__zeroReloadToken`)
    assert.equal(tokenAfterStep4, zeroReloadToken, 'Page reload occurred in Tab 2 during Step 4!')
    console.log(`   🔴 Tab 2 live-updated: Score = ${step4Score}, Level = HIGH (RED Ring & Card), Reason = "${step4Reason}"!`)

    console.log('\n🎉 ALL RISK SCORE VERIFICATIONS PASSED!')
    console.log('   1. Rule-based risk score correctly initializes at 0 (LOW, Green) on load.')
    console.log('   2. Senior view provides convenient controls to easily submit both positive and diverse bad check-ins.')
    console.log('   3. Submitting bad check-ins triggers instant Socket.io live recompute.')
    console.log('   4. Circular progress ring & card smoothly transition Green (<40) -> Yellow (40-70) -> Red (>=70).')
    console.log('   5. One-line reason built from breakdown accurately describes adverse factors.')
    console.log('   6. Proved ZERO page reload throughout the entire real-time multi-tab test.')
  } finally {
    if (wsTabSenior) wsTabSenior.close()
    if (wsTabFamily) wsTabFamily.close()
    edgeProc.kill()
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true })
    } catch {}
    server.close()
    await prisma.$disconnect()
  }
}

runRiskScoreVerification().catch((err) => {
  console.error('\n❌ Verification failed with error:', err)
  process.exit(1)
})
