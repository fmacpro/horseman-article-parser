import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import { getRawText, getFormattedText, getHtmlText, htmlCleaner } from '../controllers/textProcessing.js'

test('getRawText strips URLs', () => {
  const html = '<p>Visit <a href="http://example.com">http://example.com</a></p>'
  const text = getRawText(html)
  assert.equal(text.includes('http'), false)
})

test('getRawText removes bracketed URLs', () => {
  const html = fs.readFileSync('tests/fixtures/text/brackets.html', 'utf8')
  const text = getRawText(html)
  assert.equal(text.includes('http'), false)
})

test('getFormattedText adds title and uppercases headings', () => {
  const html = '<p>content</p>'
  const text = getFormattedText(html, 'Title', 'http://example.com')
  assert.match(text, /^TITLE\n\ncontent/)
})

test('getFormattedText preserves title case when option disabled', () => {
  const html = '<p>content</p>'
  const text = getFormattedText(html, 'Title', 'http://example.com', { uppercaseHeadings: false })
  assert.match(text, /^Title\n\ncontent/)
})

test('getHtmlText wraps lines with spans', () => {
  const res = getHtmlText('line1\nline2')
  assert.equal(res.split('\n')[0], '<span>line1</span>')
})

test('htmlCleaner resolves with sanitized html', async () => {
  const out = await htmlCleaner('&nbsp;<span>hi</span>')
  assert.equal(typeof out, 'string')
  assert.ok(out.includes('hi'))
})
