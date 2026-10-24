import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMood } from '../src/utils/mood.js'

test('parseMood: positive keywords return score 4 or 5', () => {
  const great = parseMood('Feeling great today!')
  assert.equal(great.score, 5)
  assert.equal(great.emoji, '😄')
  assert.ok(great.label.includes('Great'))

  const cheerful = parseMood('Feeling good and cheerful')
  assert.equal(cheerful.score, 4)
  assert.equal(cheerful.emoji, '😊')
})

test('parseMood: negations MUST return score 1 (Down / Needs Comfort)', () => {
  const notGood = parseMood('Not good today')
  assert.equal(notGood.score, 1, 'Not good must NOT be classified as score 4')
  assert.equal(notGood.emoji, '😔')

  const notFeelingWell = parseMood('Not feeling well')
  assert.equal(notFeelingWell.score, 1, 'Not feeling well must NOT be classified as score 4')
  assert.equal(notFeelingWell.emoji, '😔')

  const notGreat = parseMood('Not great')
  assert.equal(notGreat.score, 1, 'Not great must NOT be classified as score 5')
  assert.equal(notGreat.emoji, '😔')

  const notOkay = parseMood('Not okay right now')
  assert.equal(notOkay.score, 1, 'Not okay must NOT be classified as score 3')
  assert.equal(notOkay.emoji, '😔')

  const notHappy = parseMood('Not happy today')
  assert.equal(notHappy.score, 1, 'Not happy must NOT be classified as score 4')
  assert.equal(notHappy.emoji, '😔')
})

test('parseMood: emoji input returns corresponding mood score', () => {
  const sadEmoji = parseMood('😔')
  assert.equal(sadEmoji.score, 1)
  assert.equal(sadEmoji.emoji, '😔')

  const cryingEmoji = parseMood('Had a rough night 😢')
  assert.equal(cryingEmoji.score, 1)

  const tiredEmoji = parseMood('😴')
  assert.equal(tiredEmoji.score, 2)
  assert.equal(tiredEmoji.emoji, '😴')

  const calmEmoji = parseMood('Morning tea 😌')
  assert.equal(calmEmoji.score, 3)
  assert.equal(calmEmoji.emoji, '😌')

  const happyEmoji = parseMood('All fine 😊')
  assert.equal(happyEmoji.score, 4)

  const ecstaticEmoji = parseMood('Super happy! 😄')
  assert.equal(ecstaticEmoji.score, 5)
})

test('parseMood: tired / low energy status returns score 2', () => {
  const tired = parseMood('Feeling exhausted and fatigued')
  assert.equal(tired.score, 2)
  assert.equal(tired.emoji, '😴')
})

test('parseMood: calm / peaceful status returns score 3', () => {
  const calm = parseMood('Quiet and peaceful morning')
  assert.equal(calm.score, 3)
  assert.equal(calm.emoji, '😌')
})

test('parseMood: empty / null / unknown string defaults safely to calm/neutral (score 3 or safe default)', () => {
  const empty = parseMood('')
  assert.ok(empty.score >= 1 && empty.score <= 5)
  assert.ok(empty.emoji)

  const nullVal = parseMood(null)
  assert.ok(nullVal.score >= 1 && nullVal.score <= 5)

  const unknown = parseMood('Random note without mood words')
  assert.equal(unknown.score, 3)
})

test('parseMood: case-insensitivity and multiline / long string handling', () => {
  const upperNegation = parseMood('NOT FEELING GOOD TODAY')
  assert.equal(upperNegation.score, 1)

  const upperGreat = parseMood('ABSOLUTELY GREAT AND ENERGIZED')
  assert.equal(upperGreat.score, 5)

  const multiline = parseMood('Woke up early.\nWrote in journal.\nFeeling calm and peaceful.\nReady for lunch.')
  assert.equal(multiline.score, 3)

  const longTextWithEmoji = parseMood('Today has been quite challenging and I am feeling unwell and in pain 😔 '.repeat(5))
  assert.equal(longTextWithEmoji.score, 1)
})
