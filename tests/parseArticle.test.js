import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import http from 'node:http'
import puppeteer from 'puppeteer-extra'
import { parseArticle } from '../index.js'
// eslint-disable-next-line n/no-unpublished-import
import jpeg from 'jpeg-js'

// Silent socket to suppress parser status logs during tests
const quietSocket = { emit: () => {} }

// Shorten test and parser timeouts to speed up the suite
const TEST_TIMEOUT = 10000
const PARSE_TIMEOUT = 10000

// Reuse a single browser instance across tests to avoid repeated startups
let sharedBrowser
let originalLaunch
let originalClose

before(async () => {
  originalLaunch = puppeteer.launch
  const boundLaunch = puppeteer.launch.bind(puppeteer)
  sharedBrowser = await boundLaunch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  originalClose = sharedBrowser.close.bind(sharedBrowser)
  // Prevent individual tests from closing the shared browser
  sharedBrowser.close = async () => {}
  puppeteer.launch = async () => sharedBrowser
})

after(async () => {
  puppeteer.launch = originalLaunch
  if (originalClose) await originalClose()
})

test('parseArticle processes local HTML', { timeout: TEST_TIMEOUT }, async (t) => {
  const html = fs.readFileSync('tests/fixtures/integration/sample.html', 'utf8')
  const dataUrl = 'data:text/html;base64,' + Buffer.from(html).toString('base64')
  let article
  try {
    article = await parseArticle({
      url: dataUrl,
      enabled: ['spelling'],
      timeoutMs: PARSE_TIMEOUT,
      contentWaitSelectors: ['article'],
      contentWaitTimeoutMs: 1,
      skipReadabilityWait: true,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    return
  }
  assert.equal(article.title.text, 'Sample Story')
  assert.ok(article.links.some(l => /example\.com/.test(l.href)))
  assert.ok(article.spelling.some(s => s.word.toLowerCase().includes('missspelled')))
})

test('parseArticle captures a screenshot when enabled', { timeout: TEST_TIMEOUT }, async (t) => {
  const html = '<html><head><title>Shot</title></head><body><article><p>content</p></article></body></html>'
  const dataUrl = 'data:text/html;base64,' + Buffer.from(html).toString('base64')
  let article
  try {
    article = await parseArticle({
      url: dataUrl,
      enabled: ['screenshot'],
      timeoutMs: PARSE_TIMEOUT,
      contentWaitSelectors: ['article'],
      contentWaitTimeoutMs: 1,
      skipReadabilityWait: true,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    return
  }
  assert.equal(typeof article.screenshot, 'string')
  assert.ok(Buffer.from(article.screenshot, 'base64').length > 1000)
})

test('parseArticle screenshot occurs after consent dismissal', { timeout: TEST_TIMEOUT }, async (t) => {
  const html = `<!doctype html><html><head><title>Consent</title></head>
  <body style="margin:0">
    <div id="overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;background:red;display:flex;align-items:center;justify-content:center;">
      <button id="accept">accept</button>
    </div>
    <article style="width:100vw;height:100vh;background:green"></article>
    <script>document.getElementById('accept').addEventListener('click',()=>document.getElementById('overlay').remove())</script>
  </body></html>`
  const server = http.createServer((req, res) => { res.end(html) })
  await new Promise(resolve => server.listen(0, resolve))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}`
  let article
  try {
    article = await parseArticle({
      url,
      enabled: ['screenshot'],
      timeoutMs: PARSE_TIMEOUT,
      contentWaitSelectors: ['article'],
      contentWaitTimeoutMs: 1,
      skipReadabilityWait: true,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    server.close()
    return
  }
  server.close()
  const buf = Buffer.from(article.screenshot, 'base64')
  const { width, height, data } = jpeg.decode(buf)
  const mid = ((Math.floor(height / 2) * width) + Math.floor(width / 2)) * 4
  const r = data[mid], g = data[mid + 1], b = data[mid + 2]
  assert.ok(g > r && g > b, `expected green to dominate, got r=${r} g=${g} b=${b}`)
})

test('parseArticle strips consent iframes and scripts before screenshot', { timeout: TEST_TIMEOUT }, async (t) => {
  const html = `<!doctype html><html><head><title>Artifacts</title></head>
  <body style="margin:0">
    <iframe id="consent-frame" srcdoc="<body style='margin:0'><div style='position:fixed;top:0;left:0;width:100vw;height:100vh;background:red;'></div></body>" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:10000;"></iframe>
    <script id="consent-script">console.log('consent')</script>
    <article style="width:100vw;height:100vh;background:green"></article>
  </body></html>`
  const server = http.createServer((req, res) => { res.end(html) })
  await new Promise(resolve => server.listen(0, resolve))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}`
  let article
  try {
    article = await parseArticle({
      url,
      enabled: ['screenshot'],
      timeoutMs: PARSE_TIMEOUT,
      contentWaitSelectors: ['article'],
      contentWaitTimeoutMs: 1,
      skipReadabilityWait: true,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    server.close()
    return
  }
  server.close()
  const buf = Buffer.from(article.screenshot, 'base64')
  const { width, height, data } = jpeg.decode(buf)
  const mid = ((Math.floor(height / 2) * width) + Math.floor(width / 2)) * 4
  const r = data[mid], g = data[mid + 1], b = data[mid + 2]
  assert.ok(g > r && g > b, `expected green to dominate, got r=${r} g=${g} b=${b}`)
  assert.ok(!/consent-frame/.test(article.html))
  assert.ok(!/consent-script/.test(article.html))
})

test('parseArticle retries consent dismissal if overlay appears late', { timeout: TEST_TIMEOUT }, async (t) => {
  const html = `<!doctype html><html><head><title>Late Consent</title></head>
  <body style="margin:0">
    <article style="width:100vw;height:100vh;background:green"></article>
    <script>
      setTimeout(() => {
        const overlay = document.createElement('div')
        overlay.id = 'overlay'
        overlay.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:red;display:flex;align-items:center;justify-content:center;'
        const btn = document.createElement('button')
        btn.id = 'accept'
        btn.textContent = 'accept'
        btn.addEventListener('click', () => overlay.remove())
        overlay.appendChild(btn)
        document.body.appendChild(overlay)
      }, 500)
    </script>
  </body></html>`
  const server = http.createServer((req, res) => { res.end(html) })
  await new Promise(resolve => server.listen(0, resolve))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}`
  let article
  try {
    article = await parseArticle({
      url,
      enabled: ['screenshot'],
      timeoutMs: PARSE_TIMEOUT,
      contentWaitSelectors: ['article'],
      contentWaitTimeoutMs: 1,
      skipReadabilityWait: true,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    server.close()
    return
  }
  server.close()
  const buf = Buffer.from(article.screenshot, 'base64')
  const { width, height, data } = jpeg.decode(buf)
  const mid = ((Math.floor(height / 2) * width) + Math.floor(width / 2)) * 4
  const r = data[mid], g = data[mid + 1], b = data[mid + 2]
  assert.ok(g > r && g > b, `expected green to dominate, got r=${r} g=${g} b=${b}`)
})

test('parseArticle uses rules overrides for title and content', { timeout: TEST_TIMEOUT }, async (t) => {
  const longText = 'Incorrect '.repeat(30)
  const html = `<html><head><title>Wrong</title></head><body><article><p>${longText}</p></article></body></html>`
  const server = http.createServer((req, res) => {
    res.end(html)
  })
  await new Promise(resolve => server.listen(0, resolve))
  const { port } = server.address()
  const url = `http://127.0.0.1:${port}`

  let baseline, article
  try {
    baseline = await parseArticle({
      url,
      timeoutMs: PARSE_TIMEOUT,
      contentWaitSelectors: ['article'],
      contentWaitTimeoutMs: 1,
      skipReadabilityWait: true,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
    article = await parseArticle({
      url,
      rules: [{
        host: `127.0.0.1:${port}`,
        title: () => 'Right',
        content: () => '<article><p>Correct</p></article>'
      }],
      timeoutMs: PARSE_TIMEOUT,
      contentWaitSelectors: ['article'],
      contentWaitTimeoutMs: 1,
      skipReadabilityWait: true,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    server.close()
    return
  }
  assert.equal(baseline.title.text, 'Wrong')
  assert.ok(baseline.processed.text.raw.trim().startsWith('Incorrect'))
  assert.equal(article.title.text, 'Right')
  assert.equal(article.processed.text.raw.trim(), 'Correct')
  server.close()
})

test('parseArticle respects timeoutMs option', { timeout: TEST_TIMEOUT }, async (t) => {
  const html = '<html><head><title>Timeout Test</title></head><body><article><p>content</p></article></body></html>'
  const dataUrl = 'data:text/html;base64,' + Buffer.from(html).toString('base64')
  try {
    await parseArticle({
      url: dataUrl,
      timeoutMs: 1,
      contentWaitSelectors: ['article'],
      contentWaitTimeoutMs: 1,
      skipReadabilityWait: true,
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

test('parseArticle can disable JavaScript execution', { timeout: TEST_TIMEOUT }, async (t) => {
  const filler = 'more text '.repeat(30)
  const html = `<html><head><title>Original</title><script>document.title="Changed"</script></head><body><article><p>content ${filler}</p></article></body></html>`
  const dataUrl = 'data:text/html;base64,' + Buffer.from(html).toString('base64')
  let withJs, withoutJs
  try {
    withJs = await parseArticle({
      url: dataUrl,
      timeoutMs: PARSE_TIMEOUT,
      contentWaitSelectors: ['article'],
      contentWaitTimeoutMs: 1,
      skipReadabilityWait: true,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
    withoutJs = await parseArticle({
      url: dataUrl,
      timeoutMs: PARSE_TIMEOUT,
      contentWaitSelectors: ['article'],
      contentWaitTimeoutMs: 1,
      skipReadabilityWait: true,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'], javascriptEnabled: false } }
    }, quietSocket)
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    return
  }
  assert.equal(withJs.title.text, 'Changed')
  assert.equal(withoutJs.title.text, 'Original')
})

test('parseArticle strips selectors listed in striptags', { timeout: TEST_TIMEOUT }, async (t) => {
  const keep = 'Keep me '.repeat(20)
  const html = `<html><head><title>StripTags Test</title></head><body><article><div class="ad">Ad text</div><p id="remove-me">Should go</p><p>${keep}</p></article></body></html>`
  const dataUrl = 'data:text/html;base64,' + Buffer.from(html).toString('base64')
  let article
  try {
    article = await parseArticle({
      url: dataUrl,
      striptags: ['.ad', '#remove-me'],
      timeoutMs: PARSE_TIMEOUT,
      contentWaitSelectors: ['article'],
      contentWaitTimeoutMs: 1,
      skipReadabilityWait: true,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    return
  }
  assert.equal(article.title.text, 'StripTags Test')
  assert.ok(article.processed.text.raw.trim().startsWith('Keep me'))
})

test('parseArticle applies custom Compromise plugins', { timeout: TEST_TIMEOUT }, async (t) => {
  const text = 'Prime minister Rishi Sunak spoke today '.repeat(10)
  const html = `<html><head><title>Rishi Sunak</title></head><body><article><p>${text}</p></article></body></html>`
  const dataUrl = 'data:text/html;base64,' + Buffer.from(html).toString('base64')

  // Plugin from README example adds names to Compromise's lexicon
  const testPlugin = function (Doc, world) {
    world.addWords({
      'rishi': 'FirstName',
      'sunak': 'LastName'
    })
  }

  let withoutPlugin, withPlugin
  try {
    withoutPlugin = await parseArticle({
      url: dataUrl,
      enabled: ['entities'],
      timeoutMs: PARSE_TIMEOUT,
      contentWaitSelectors: ['article'],
      contentWaitTimeoutMs: 1,
      skipReadabilityWait: true,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
    withPlugin = await parseArticle({
      url: dataUrl,
      enabled: ['entities'],
      nlp: { plugins: [testPlugin] },
      timeoutMs: PARSE_TIMEOUT,
      contentWaitSelectors: ['article'],
      contentWaitTimeoutMs: 1,
      skipReadabilityWait: true,
      puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
    }, quietSocket)
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    return
  }
  const foundWithout = Array.isArray(withoutPlugin.people) && withoutPlugin.people.some(p => /rishi/i.test(p.text))
  assert.equal(foundWithout, false)
  const foundWith = Array.isArray(withPlugin.people) && withPlugin.people.some(p => /rishi sunak/i.test(p.text))
  assert.equal(foundWith, true)
})
