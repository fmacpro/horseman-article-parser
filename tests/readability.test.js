import { test } from 'node:test'
import assert from 'node:assert/strict'
import checkReadability from '../controllers/readability.js'

test('checkReadability returns basic counts', async () => {
  const text = 'First sentence. Second sentence!\n\nNew paragraph here.'
  const res = await checkReadability(text)
  assert.equal('scores' in res, false)
  assert.equal(res.characters, text.trim().length)
  assert.equal(res.words, 7)
  assert.equal(res.sentences, 3)
  assert.equal(res.paragraphs, 2)
})
