import { test } from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import fs from 'fs'
import { detectContent } from '../controllers/contentDetector.js'

test('detectContent extracts article HTML', () => {
  const html = '<html><body><article><p>Hello World</p></article></body></html>'
  const { window } = new JSDOM(html)
  const res = detectContent(window.document)
  assert.match(res.html, /Hello World/)
})

test('detectContent handles real news fixture', () => {
  const html = fs.readFileSync('tests/fixtures/content/news.html', 'utf8')
  const { window } = new JSDOM(html)
  const res = detectContent(window.document)
  assert.match(res.html, /Real news article paragraph one/)
  assert.equal(res.selector, 'article')
  assert.equal(res.html.includes('<nav'), false)
})

test('detectContent strips boilerplate from blog fixture', () => {
  const html = fs.readFileSync('tests/fixtures/content/blog.html', 'utf8')
  const { window } = new JSDOM(html)
  const res = detectContent(window.document)
  assert.match(res.html, /Blog Title/)
  assert.doesNotMatch(res.html, /Home/)
})

test('detectContent promotes the direct parent for fragmented articles', () => {
  const part1 = 'First fragment text with enough content to meet the minimum length requirement. '.repeat(6)
  const part2 = 'Second fragment ensures aggregated content meets heuristics properly. '.repeat(6)
  const html = `
    <html>
      <body>
        <article id="story">
          <header><h1>Fragmented Story</h1></header>
          <div id="article-body">
            <div class="segment"><p>${part1}</p></div>
            <div class="segment"><p>${part2}</p></div>
          </div>
          <footer><p>Footer details</p></footer>
        </article>
      </body>
    </html>
  `
  const { window } = new JSDOM(html)
  const res = detectContent(window.document)
  assert.equal(res.selector, '#article-body')
  assert.match(res.html, /First fragment text/)
  assert.match(res.html, /Second fragment ensures aggregated content/)
})
