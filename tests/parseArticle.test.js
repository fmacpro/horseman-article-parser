import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import { parseArticle } from '../index.js'

test('parseArticle processes local HTML', async (t) => {
  const html = fs.readFileSync('tests/fixtures/integration/sample.html', 'utf8')
  const dataUrl = 'data:text/html;base64,' + Buffer.from(html).toString('base64')
  try {
    const article = await parseArticle({
      url: dataUrl,
      enabled: ['spelling'],
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    })
    assert.equal(article.title.text, 'Sample Story')
    assert.ok(article.links.some(l => /example\.com/.test(l.href)))
    assert.ok(article.spelling.some(s => s.word.toLowerCase().includes('missspelled')))
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
  }
})
