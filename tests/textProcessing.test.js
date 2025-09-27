import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import { getRawText, getFormattedText, getHtmlText, htmlCleaner, stripNonArticleElements, sanitizeArticleContent, unwrapNodePreservingChildren } from '../controllers/textProcessing.js'
import { JSDOM } from 'jsdom'

test('getRawText strips URLs', () => {
  const html = '<p>Visit <a href=\"http://example.com\">http://example.com</a></p>'
  const text = getRawText(html)
  assert.equal(text.includes('http'), false)
})

test('getRawText removes bracketed URLs', () => {
  const html = fs.readFileSync('tests/fixtures/text/brackets.html', 'utf8')
  const text = getRawText(html)
  assert.equal(text.includes('http'), false)
})

test('getRawText strips embedded data URIs from brackets', () => {
  const html = '<p>Image [data:image/gif;base64,SGVsbG8=]</p>'
  const text = getRawText(html)
  assert.equal(text, 'Image')
})

test('getRawText inserts sentence breaks for uppercase paragraphs', () => {
  const html = '<p>The teenager married too many times to count</p><p>By Nawal al-Maghafi</p>'
  const text = getRawText(html)
  assert.equal(text, 'The teenager married too many times to count. By Nawal al-Maghafi')
})

test('getRawText preserves flow for lowercase paragraph starts', () => {
  const html = '<p>He said</p><p>that this is good</p>'
  const text = getRawText(html)
  assert.equal(text, 'He said that this is good')
})

test('getRawText removes image alts and captions', () => {
  const html = '<p>Intro paragraph.</p><figure><img src=\"https://example.com/image.jpg\" alt=\"Sample alt text\"><figcaption>Caption text</figcaption></figure><p>Final paragraph.</p>'
  const text = getRawText(html)
  assert.equal(text, 'Intro paragraph. Final paragraph.')
})

test('getFormattedText adds title and uppercases headings', () => {
  const html = '<p>content</p>'
  const text = getFormattedText(html, 'Title', 'http://example.com')
  assert.equal(text, 'TITLE\n\ncontent')
})

test('getFormattedText preserves title case when option disabled', () => {
  const html = '<p>content</p>'
  const text = getFormattedText(html, 'Title', 'http://example.com', { uppercaseHeadings: false })
  assert.equal(text, 'Title\n\ncontent')
})

test('getFormattedText drops data URLs but keeps html links', () => {
  const html = '<p>Read the <a href=\"https://example.com/story.html\">full story</a>.</p><p>Attachment [data:image/gif;base64,AAAA]</p>'
  const text = getFormattedText(html, 'Title', 'https://example.com', { uppercaseHeadings: false, ignoreHref: false })
  assert.ok(text.includes('https://example.com/story.html'))
  assert.ok(!text.includes('data:image'))
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

test('sanitizeArticleContent unwraps linked figures and removes captions', () => {
  const html = `
    <article>
      <figure class="wp-caption">
        <a href="/gallery"><picture><img src="/image.jpg" alt="desc" /></picture></a>
        <figcaption>Image caption text</figcaption>
      </figure>
      <p>Paragraph after image.</p>
    </article>
  `
  const sanitized = sanitizeArticleContent(html)
  assert.ok(/<img[^>]*src="\/image\.jpg"/.test(sanitized))
  assert.ok(!/<a\b/i.test(sanitized))
  assert.ok(!sanitized.includes('figcaption'))
  assert.ok(!sanitized.includes('Image caption text'))
  assert.ok(/<img[^>]*>\s*<p>Paragraph after image\./.test(sanitized))
})

test('sanitizeArticleContent removes CTA containers but keeps tabular data', () => {
  const html = `
    <div class="newsletter-signup">
      <p>Subscribe now for updates</p>
    </div>
    <table>
      <tr><th>Item</th><th>Value</th></tr>
      <tr><td>Foo</td><td>42</td></tr>
    </table>
  `
  const sanitized = sanitizeArticleContent(html)
  assert.ok(!sanitized.includes('Subscribe now for updates'))
  assert.ok(sanitized.includes('<table'))
  assert.ok(sanitized.includes('<td>Foo</td>'))
})

test('unwrapNodePreservingChildren keeps spacing between inline siblings', () => {
  const dom = new JSDOM('<p><span>John</span><span>Mary</span></p>')
  const [firstSpan, secondSpan] = Array.from(dom.window.document.querySelectorAll('span'))
  unwrapNodePreservingChildren(firstSpan)
  assert.equal(dom.window.document.querySelector('p').textContent, 'John Mary')
  unwrapNodePreservingChildren(secondSpan)
  assert.equal(dom.window.document.querySelector('p').textContent, 'John Mary')
})

test('unwrapNodePreservingChildren inserts space around strong wrappers', () => {
  const dom = new JSDOM('<p>Alpha<span><strong>Beta</strong></span><span>Gamma</span></p>')
  const spans = Array.from(dom.window.document.querySelectorAll('span'))
  unwrapNodePreservingChildren(spans[0])
  unwrapNodePreservingChildren(spans[1])
  assert.equal(dom.window.document.querySelector('p').textContent, 'Alpha Beta Gamma')
})






