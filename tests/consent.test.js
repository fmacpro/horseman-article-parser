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
