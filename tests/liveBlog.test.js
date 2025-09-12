import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import fs from 'fs'
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

test('buildLiveBlogSummary ignores time-only lists', () => {
  const html = `\n  <div>\n    <div><time>1h ago</time><h2>One</h2></div>\n    <div><time>2h ago</time><h2>Two</h2></div>\n    <div><time>3h ago</time><h2>Three</h2></div>\n    <div><time>4h ago</time><h2>Four</h2></div>\n    <div><time>5h ago</time><h2>Five</h2></div>\n  </div>`
  const { window } = new JSDOM(html)
  const res = buildLiveBlogSummary(window.document)
  assert.equal(res.ok, false)
})

test('buildLiveBlogSummary handles amp-live-list', () => {
  const html = fs.readFileSync('tests/fixtures/liveblog/amp.html', 'utf8')
  const { window } = new JSDOM(html)
  const res = buildLiveBlogSummary(window.document)
  assert.equal(res.ok, true)
  assert.equal(res.count, 3)
})

test('buildLiveBlogSummary limits to forty updates', () => {
  const html = fs.readFileSync('tests/fixtures/liveblog/many.html', 'utf8')
  const { window } = new JSDOM(html)
  const res = buildLiveBlogSummary(window.document)
  assert.equal(res.ok, true)
  assert.equal(res.count, 5)
})
