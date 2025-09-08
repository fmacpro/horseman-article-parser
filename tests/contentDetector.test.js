import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { detectContent } from '../controllers/contentDetector.js'

test('detectContent extracts article HTML', () => {
  const html = '<html><body><article><p>Hello World</p></article></body></html>'
  const { window } = new JSDOM(html)
  const res = detectContent(window.document)
  assert.match(res.html, /Hello World/)
})
