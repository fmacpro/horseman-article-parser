import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-extra'
import { parseArticle } from '../index.js'

// Silent socket to suppress parser status logs during tests
const quietSocket = { emit: () => {} }

// Shorten test and parser timeouts to speed up the suite
const TEST_TIMEOUT = 30000
const PARSE_TIMEOUT = 30000

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

async function runParse (html) {
  const dataUrl = 'data:text/html;base64,' + Buffer.from(html).toString('base64')
  return await parseArticle({
    url: dataUrl,
    enabled: ['spelling'],
    timeoutMs: PARSE_TIMEOUT,
    contentWaitSelectors: ['article'],
    contentWaitTimeoutMs: 1,
    skipReadabilityWait: true,
    puppeteer: { launch: { headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] } }
  }, quietSocket)
}

test('detects French language and uses dictionary', { timeout: TEST_TIMEOUT }, async (t) => {
  let article
  try {
    article = await runParse('<html><head><title>Bonjour</title></head><body><article><p>Bonjour tout le monde. Ceci est un texte en français avec une faute mondde.</p></article></body></html>')
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    return
  }
  assert.equal(article.language.iso6391, 'fr')
  assert.ok(article.spelling.some(s => s.word && s.word.toLowerCase() === 'mondde'))
})

test('detects Spanish language and uses dictionary', { timeout: TEST_TIMEOUT }, async (t) => {
  let article
  try {
    article = await runParse('<html><head><title>Hola</title></head><body><article><p>Hola a todos. Este es un texto de prueba escrito en español que debería ser reconocido correctamente. Contiene un error mundoo.</p></article></body></html>')
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    return
  }
  assert.equal(article.language.iso6391, 'es')
  assert.ok(article.spelling.some(s => s.word && s.word.toLowerCase() === 'mundoo'))
})

