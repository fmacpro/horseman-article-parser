import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import { getRawText, getFormattedText, getHtmlText, htmlCleaner, stripNonArticleElements } from '../controllers/textProcessing.js'

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

test('stripNonArticleElements removes empty anchors and retains body text', () => {
  const html = '<div><a href="/story"><img src="pic.jpg" alt="" /></a><p>Actual story text.</p></div>'
  const sanitized = stripNonArticleElements(html)
  assert.ok(sanitized.includes('Actual story text'))
  assert.ok(!sanitized.includes('<a'))
})

test('stripNonArticleElements removes newsletter and CTA containers', () => {
  const html = `
    <div class="newsletter-signup">
      <form>
        <label>Sign up for our newsletter</label>
        <input type="email" />
      </form>
      <p>Subscribe for updates.</p>
    </div>
    <p>Article paragraph with context.</p>
  `
  const sanitized = stripNonArticleElements(html)
  assert.ok(sanitized.includes('Article paragraph with context'))
  assert.ok(!sanitized.includes('Sign up for our newsletter'))
  assert.ok(!sanitized.includes('newsletter-signup'))
})

test('stripNonArticleElements keeps text-based lists', () => {
  const html = '<article><ul><li>First important fact</li><li>Second detail</li></ul></article>'
  const sanitized = stripNonArticleElements(html)
  assert.ok(sanitized.includes('<ul'))
  assert.ok(sanitized.includes('First important fact'))
})

test('stripNonArticleElements drops recirculation link lists', () => {
  const html = `
    <div class="related">
      <ul>
        <li><a href="/one">Story One</a></li>
        <li><a href="/two">Story Two</a></li>
      </ul>
    </div>
    <p>Main body continues.</p>
  `
  const sanitized = stripNonArticleElements(html)
  assert.ok(sanitized.includes('Main body continues'))
  assert.ok(!sanitized.includes('Story One'))
  assert.ok(!sanitized.includes('Story Two'))
})
