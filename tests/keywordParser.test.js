import { test } from 'node:test'
import assert from 'node:assert/strict'
import keywordParser from '../controllers/keywordParser.js'

test('keywordParser returns keyword and keyphrase arrays', async () => {
  const res = await keywordParser('JavaScript is great. Node.js uses JavaScript.')
  assert.ok(Array.isArray(res.keywords))
  assert.ok(res.keywords.length > 0)
  assert.ok(Array.isArray(res.keyphrases))
})
