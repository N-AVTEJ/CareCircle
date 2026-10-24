import test from 'node:test'
import assert from 'node:assert/strict'
import { formatRiskReason, getRiskTheme } from '../src/utils/risk.js'

test('formatRiskReason: builds prompt-specified example ("Skipped 2 meals, mood low 3 days")', () => {
  const reason = formatRiskReason({
    missedPills: 0,
    skippedMeals: 2,
    badMoodStreak: 3,
  })
  assert.equal(reason, 'Skipped 2 meals, mood low 3 days')
})

test('formatRiskReason: handles single count plurals correctly', () => {
  const reason = formatRiskReason({
    missedPills: 1,
    skippedMeals: 1,
    badMoodStreak: 1,
  })
  assert.equal(reason, 'Missed 1 pill, Skipped 1 meal, mood low 1 day')
})

test('formatRiskReason: returns default when no risk factors present', () => {
  const reason = formatRiskReason({
    missedPills: 0,
    skippedMeals: 0,
    badMoodStreak: 0,
  })
  assert.equal(reason, 'All check-ins on track')

  const reasonEmpty = formatRiskReason({})
  assert.equal(reasonEmpty, 'All check-ins on track')
})

test('getRiskTheme: green < 40, yellow 40-70, red > 70', () => {
  const low0 = getRiskTheme(0)
  assert.equal(low0.level, 'LOW')
  assert.equal(low0.hex, '#10b981')

  const low39 = getRiskTheme(39)
  assert.equal(low39.level, 'LOW')
  assert.equal(low39.hex, '#10b981')

  const med40 = getRiskTheme(40)
  assert.equal(med40.level, 'MEDIUM')
  assert.equal(med40.hex, '#f59e0b')

  const med69 = getRiskTheme(69)
  assert.equal(med69.level, 'MEDIUM')
  assert.equal(med69.hex, '#f59e0b')

  const high70 = getRiskTheme(70)
  assert.equal(high70.level, 'HIGH')
  assert.equal(high70.hex, '#ef4444')

  const high100 = getRiskTheme(100)
  assert.equal(high100.level, 'HIGH')
  assert.equal(high100.hex, '#ef4444')
})
