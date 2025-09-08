import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { buildLiveBlogSummary } from '../controllers/liveBlog.js'

test('buildLiveBlogSummary extracts entries from live blog', () => {
  const html = `\n  <article>\n    <div class="update"><time>10:00 AM</time><h2>First</h2><p>${'A'.repeat(70)}</p></div>\n    <div class="update"><time>11:00 AM</time><h2>Second</h2><p>${'B'.repeat(80)}</p></div>\n    <div class="update"><time>12:00 PM</time><h2>Third</h2><p>${'C'.repeat(90)}</p></div>\n  </article>`
  const { window } = new JSDOM(html)
  const res = buildLiveBlogSummary(window.document)
  assert.equal(res.ok, true)
  assert.equal(res.count, 3)
  assert.match(res.html, /live-summary/)
})

test('buildLiveBlogSummary returns ok false when insufficient data', () => {
  const html = '<article><div class="update"><p>short</p></div></article>'
  const { window } = new JSDOM(html)
  const res = buildLiveBlogSummary(window.document)
  assert.equal(res.ok, false)
})
