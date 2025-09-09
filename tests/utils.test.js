import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeDataUrl } from '../controllers/utils.js'

const sampleHtml = '<html><body><script>evil()</script><p>Safe</p></body></html>'
const dataUrl = 'data:text/html;base64,' + Buffer.from(sampleHtml).toString('base64')

test('sanitizeDataUrl removes scripts when JavaScript is disabled', () => {
  const { html, sanitizedUrl } = sanitizeDataUrl(dataUrl, false)
  assert.ok(!html.includes('<script>'))
  const decoded = Buffer.from(sanitizedUrl.split(',')[1], 'base64').toString('utf8')
  assert.ok(!decoded.includes('<script>'))
})

test('sanitizeDataUrl retains scripts when JavaScript is enabled', () => {
  const { html } = sanitizeDataUrl(dataUrl, true)
  assert.ok(html.includes('<script>'))
})
