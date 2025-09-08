
import { test } from 'node:test'
import assert from 'node:assert/strict'
import lighthouseAnalysis from '../controllers/lighthouse.js'

test('lighthouseAnalysis runs with mocked lighthouse', async () => {
  const fakeLhr = { categories: {} }
  const fake = async () => ({ lhr: fakeLhr })
  const socketMsgs = []
  const socket = { emit: (_t, msg) => socketMsgs.push(msg) }
  const browser = { wsEndpoint: () => 'ws://localhost:9222' }
  const res = await lighthouseAnalysis(browser, { url: 'http://example.com' }, socket, fake)
  assert.equal(res, fakeLhr)
  assert.ok(socketMsgs.some(m => m.includes('Starting Lighthouse')))
  assert.ok(socketMsgs.some(m => m.includes('Lighthouse Analysis Complete')))
})
