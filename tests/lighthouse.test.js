
import { test, mock } from 'node:test'
import assert from 'node:assert/strict'

test('lighthouseAnalysis runs with mocked lighthouse', async (t) => {
  if (typeof mock.module !== 'function') {
    t.skip('module mocking not supported')
    return
  }
  const fakeLhr = { categories: {} }
  mock.module('lighthouse', { default: async () => ({ lhr: fakeLhr }) })
  const { default: lighthouseAnalysis } = await import('../controllers/lighthouse.js')
  const socketMsgs = []
  const socket = { emit: (_t, msg) => socketMsgs.push(msg) }
  const browser = { wsEndpoint: () => 'ws://localhost:9222' }
  const res = await lighthouseAnalysis(browser, { url: 'http://example.com' }, socket)
  assert.equal(res, fakeLhr)
  assert.ok(socketMsgs.some(m => m.includes('Starting Lighthouse')))
  assert.ok(socketMsgs.some(m => m.includes('Lighthouse Analysis Complete')))
})
