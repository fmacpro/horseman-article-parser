import { test } from 'node:test'
import assert from 'node:assert/strict'
import { safeAwait, sleep } from '../controllers/async.js'

test('safeAwait returns resolved value', async () => {
  const result = await safeAwait(Promise.resolve(42))
  assert.equal(result, 42)
})

test('safeAwait returns undefined on rejection', async () => {
  const result = await safeAwait(Promise.reject(new Error('fail')))
  assert.equal(result, undefined)
})

test('sleep waits for at least specified time', async () => {
  const start = Date.now()
  await sleep(20)
  assert.ok(Date.now() - start >= 20)
})
