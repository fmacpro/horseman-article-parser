import { test } from 'node:test'
import assert from 'node:assert/strict'
import spellCheck from '../controllers/spellCheck.js'

test('spellCheck identifies misspellings', async () => {
  const res = await spellCheck('This sentense has a mispelled wurd.')
  assert.ok(Array.isArray(res))
  assert.ok(res.length > 0)
})

test('spellCheck respects options and filters URLs', async () => {
  const sentence = 'A sentense with https://example.com and mispelled wurd.'
  const res = await spellCheck(sentence, { tweaks: { ignoreUrlLike: true, includeOffsets: true } })
  assert.ok(res.some(r => r.word === 'sentense'))
  assert.ok(res.every(r => !r.word.includes('http')))
  assert.ok(res[0].offsetStart !== undefined)
  assert.ok(res[0].offsetEnd !== undefined)
})
