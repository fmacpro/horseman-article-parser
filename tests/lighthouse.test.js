import { test } from 'node:test'
import assert from 'node:assert/strict'
import lighthouseAnalysis from '../controllers/lighthouse.js'

test('lighthouseAnalysis is a function', () => {
  assert.equal(typeof lighthouseAnalysis, 'function')
})
