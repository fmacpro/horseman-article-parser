import { test, mock } from 'node:test'
import assert from 'node:assert/strict'
import { createLogger } from '../controllers/logger.js'

test('createLogger respects quiet flag', () => {
  const hook = mock.method(console, 'log', () => {})
  const quiet = createLogger({ quiet: true })
  quiet.log('hidden')
  assert.equal(hook.mock.calls.length, 0)
  const loud = createLogger()
  loud.log('visible')
  assert.equal(hook.mock.calls.length, 1)
  hook.mock.restore()
})
