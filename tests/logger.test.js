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

test('logger methods warn and error obey quiet mode', () => {
  const warnHook = mock.method(console, 'warn', () => {})
  const errorHook = mock.method(console, 'error', () => {})
  const quiet = createLogger({ quiet: true })
  quiet.warn('hidden')
  quiet.error('hidden')
  assert.equal(warnHook.mock.calls.length, 0)
  assert.equal(errorHook.mock.calls.length, 0)
  const loud = createLogger()
  loud.warn('shown')
  loud.error('shown')
  assert.equal(warnHook.mock.calls.length, 1)
  assert.equal(errorHook.mock.calls.length, 1)
  warnHook.mock.restore()
  errorHook.mock.restore()
})
