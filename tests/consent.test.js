import { test } from 'node:test'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-extra'
import { autoDismissConsent } from '../controllers/consent.js'

test('autoDismissConsent handles empty page', async () => {
  const page = {
    frames: () => [],
    waitForTimeout: async () => {},
    waitForNavigation: async () => {},
    keyboard: { press: async () => {} }
  }
  await assert.doesNotReject(() => autoDismissConsent(page))
})

test('autoDismissConsent clicks selectors and text patterns', async () => {
  let selectorClicks = 0
  let textClicks = 0
  let navigated = false
  const el = { click: async () => { selectorClicks++ }, evaluate: async () => {} }
  const frame = {
    $: async (sel) => (sel === '.accept' ? el : null),
    evaluate: async (_fn, _patterns, remaining) => { textClicks += Math.min(1, remaining); return Math.min(1, remaining) }
  }
  const page = {
    frames: () => [frame],
    waitForTimeout: async () => {},
    waitForNavigation: async () => { navigated = true },
    keyboard: { press: async () => {} }
  }
  await autoDismissConsent(page, {
    selectors: ['.accept', '.decline'],
    textPatterns: ['agree'],
    maxClicks: 2
  })
  assert.equal(selectorClicks, 1)
  assert.equal(textClicks, 1)
  assert.equal(navigated, true)
})

test('autoDismissConsent dismisses overlay without consent keywords', async (t) => {
  let browser
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    return
  }
  const page = await browser.newPage()
  const html = `<!doctype html><html><body>
    <div class="message-container gu-overlay" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:10000;display:flex;align-items:center;justify-content:center;background:red;">
      <button id="accept">Accept all</button>
    </div>
    <script>document.getElementById('accept').addEventListener('click',()=>document.querySelector('.message-container').remove())</script>
  </body></html>`
  await page.setContent(html)
  await autoDismissConsent(page, { textPatterns: ['accept all'] })
  const overlay = await page.$('.message-container')
  assert.equal(overlay, null)
  await browser.close()
})
