import { test } from 'node:test'
import assert from 'node:assert/strict'
import spellCheck from '../controllers/spellCheck.js'

test('spellCheck identifies misspellings', async () => {
  const res = await spellCheck('This sentense has a mispelled wurd.')
  assert.ok(Array.isArray(res))
  assert.ok(res.length > 0)
})
