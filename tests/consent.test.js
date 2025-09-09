import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoDismissConsent } from '../controllers/consent.js'

test('autoDismissConsent handles empty page', async () => {
  const page = {
    frames: () => [],
    waitForTimeout: async () => {},
    waitForNavigation: async () => {},
    keyboard: { press: async () => {} }
  }
  await assert.doesNotReject(() => autoDismissConsent(page))
})

test('autoDismissConsent clicks selectors and text patterns', async () => {
  let selectorClicks = 0
  let textClicks = 0
  let navigated = false
  const el = { click: async () => { selectorClicks++ }, evaluate: async () => {} }
  const frame = {
    $: async (sel) => (sel === '.accept' ? el : null),
    evaluate: async (_fn, _patterns, remaining) => { textClicks += Math.min(1, remaining); return Math.min(1, remaining) }
  }
  const page = {
    frames: () => [frame],
    waitForTimeout: async () => {},
    waitForNavigation: async () => { navigated = true },
    keyboard: { press: async () => {} }
  }
  await autoDismissConsent(page, {
    selectors: ['.accept', '.decline'],
    textPatterns: ['agree'],
    maxClicks: 2
  })
  assert.equal(selectorClicks, 1)
  assert.equal(textClicks, 1)
  assert.equal(navigated, true)
})
