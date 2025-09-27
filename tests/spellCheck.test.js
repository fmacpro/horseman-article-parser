import { test } from 'node:test'
import assert from 'node:assert/strict'
import spellCheck from '../controllers/spellCheck.js'

test('spellCheck identifies misspellings', async () => {
  const res = await spellCheck('This sentense has a mispelled wurd.')
  assert.ok(Array.isArray(res))
  assert.ok(res.length > 0)
})

test('spellCheck respects options and filters URLs', async () => {
  const sentence = 'A sentense with https://example.com, data:image/gif;base64,AAAA and mispelled wurd.'
  const res = await spellCheck(sentence, { tweaks: { ignoreUrlLike: true, includeOffsets: true } })
  assert.ok(res.some(r => r.word === 'sentense'))
  assert.ok(res.every(r => !r.word.includes('http')))
  assert.ok(res.every(r => !String(r.word || '').includes('data:')))
  assert.ok(res[0].offsetStart !== undefined)
  assert.ok(res[0].offsetEnd !== undefined)
})


test('spellCheck ignores data URLs in suggestions', async () => {
  const text = 'Prefix data:image/png;base64,AAAA\nLine with mispelled wurd'
  const res = await spellCheck(text)
  assert.ok(res.some(r => r.word && r.word.toLowerCase().includes('wurd')))
  assert.ok(res.every(r => !String(r.word || '').includes('data:image')))
})
test('spellCheck preserves line breaks for accurate line numbers', async () => {
  const text = 'First line\nSecond lnie with error\nThird line'
  const res = await spellCheck(text)
  const miss = res.find(r => r.word && r.word.toLowerCase() === 'lnie')
  assert.equal(miss.line, 2)
})

test('spellCheck retains hyphenated words', async () => {
  const res = await spellCheck('mispelled-wurd should be flagged')
  assert.ok(res.some(r => r.word === 'mispelled-wurd'))
})

