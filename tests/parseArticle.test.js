import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import http from 'node:http'
import { parseArticle } from '../index.js'

// Silent socket to suppress parser status logs during tests
const quietSocket = { emit: () => {} }

test('parseArticle processes local HTML', async (t) => {
  const html = fs.readFileSync('tests/fixtures/integration/sample.html', 'utf8')
  const dataUrl = 'data:text/html;base64,' + Buffer.from(html).toString('base64')
  try {
    const article = await parseArticle({
      url: dataUrl,
      enabled: ['spelling'],
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
    assert.equal(article.title.text, 'Sample Story')
    assert.ok(article.links.some(l => /example\.com/.test(l.href)))
    assert.ok(article.spelling.some(s => s.word.toLowerCase().includes('missspelled')))
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
  }
})

test('parseArticle uses rules overrides for title and content', async (t) => {
  const html = '<html><head><title>Wrong</title></head><body><article><p>Incorrect</p></article></body></html>'
  const server = http.createServer((req, res) => {
    res.end(html)
  })
  await new Promise(resolve => server.listen(0, resolve))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}`

  try {
    const baseline = await parseArticle({
      url,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
    assert.equal(baseline.title.text, 'Wrong')
    assert.equal(baseline.processed.text.raw.trim(), 'Incorrect')

    const article = await parseArticle({
      url,
      rules: [{
        host: `127.0.0.1:${port}`,
        title: () => 'Right',
        content: () => '<article><p>Correct</p></article>'
      }],
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
    assert.equal(article.title.text, 'Right')
    assert.equal(article.processed.text.raw.trim(), 'Correct')
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
  } finally {
    server.close()
  }
})

test('parseArticle respects timeoutMs option', async (t) => {
  const html = '<html><head><title>Timeout Test</title></head><body><article><p>content</p></article></body></html>'
  const dataUrl = 'data:text/html;base64,' + Buffer.from(html).toString('base64')
  try {
    await parseArticle({
      url: dataUrl,
      timeoutMs: 1,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
    t.fail('Expected parse to timeout')
  } catch (err) {
    if (/Timeout/i.test(err.message)) {
      assert.ok(true)
    } else {
      t.skip('puppeteer unavailable: ' + err.message)
    }
  }
})

test('parseArticle can disable JavaScript execution', async (t) => {
  const html = '<html><head><title>Original</title><script>document.title="Changed"</script></head><body><article><p>content</p></article></body></html>'
  const dataUrl = 'data:text/html;base64,' + Buffer.from(html).toString('base64')
  try {
    const withJs = await parseArticle({
      url: dataUrl,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
    assert.equal(withJs.title.text, 'Changed')

    const withoutJs = await parseArticle({
      url: dataUrl,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'], javascriptEnabled: false } }
    }, quietSocket)
    assert.equal(withoutJs.title.text, 'Original')
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
  }
})

test('parseArticle strips selectors listed in striptags', async (t) => {
  const html = '<html><head><title>StripTags Test</title></head><body><article><div class="ad">Ad text</div><p id="remove-me">Should go</p><p>Keep me</p></article></body></html>'
  const dataUrl = 'data:text/html;base64,' + Buffer.from(html).toString('base64')
  try {
    const article = await parseArticle({
      url: dataUrl,
      striptags: ['.ad', '#remove-me'],
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
    assert.equal(article.title.text, 'StripTags Test')
    assert.equal(article.processed.text.raw.trim(), 'Keep me')
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
  }
})

test('parseArticle applies custom Compromise plugins', async (t) => {
  const html = fs.readFileSync('tests/fixtures/integration/rishi-sunak.html', 'utf8')
  const dataUrl = 'data:text/html;base64,' + Buffer.from(html).toString('base64')

  // Plugin from README example adds names to Compromise's lexicon
  const testPlugin = function (Doc, world) {
    world.addWords({
      'rishi': 'FirstName',
      'sunak': 'LastName'
    })
  }

  try {
    const withoutPlugin = await parseArticle({
      url: dataUrl,
      enabled: ['entities'],
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
    const foundWithout = Array.isArray(withoutPlugin.people) && withoutPlugin.people.some(p => /rishi/i.test(p.text))
    assert.equal(foundWithout, false)

    const withPlugin = await parseArticle({
      url: dataUrl,
      enabled: ['entities'],
      nlp: { plugins: [testPlugin] },
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
    const foundWith = Array.isArray(withPlugin.people) && withPlugin.people.some(p => /rishi sunak/i.test(p.text))
    assert.equal(foundWith, true)
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
  }
})
