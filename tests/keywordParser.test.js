import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import keywordParser from '../controllers/keywordParser.js'

test('keywordParser returns keyword and keyphrase arrays', async () => {
  const res = await keywordParser('JavaScript is great. Node.js uses JavaScript.')
  assert.ok(Array.isArray(res.keywords))
  assert.ok(res.keywords.length > 0)
  assert.ok(Array.isArray(res.keyphrases))
})

test('keywordParser ranks real article text', async () => {
  const text = fs.readFileSync('tests/fixtures/keywords.txt', 'utf8')
  const res = await keywordParser(text)
  assert.equal(res.keywords[0].keyword, 'JavaScript')
  assert.ok(res.keywords[0].score >= res.keywords[1].score)
  assert.match(res.keyphrases[0].keyphrase, /JavaScript/)
})

test('keywordParser capitalizes keywords and keyphrases', async () => {
  const res = await keywordParser('javascript is great. javascript makes the web work.')
  assert.equal(res.keywords[0].keyword[0], res.keywords[0].keyword[0].toUpperCase())
  assert.equal(res.keyphrases[0].keyphrase[0], res.keyphrases[0].keyphrase[0].toUpperCase())
})
