import { test } from 'node:test'
import assert from 'node:assert/strict'
import puppeteer from 'puppeteer-extra'
import { autoDismissConsent, injectTcfApi } from '../controllers/consent.js'
import { setDefaultOptions } from '../helpers.js'

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
    evaluate: async (fn, _patterns, remaining) => {
      if (typeof remaining === 'number') {
        textClicks += Math.min(1, remaining)
        return Math.min(1, remaining)
      }
      return 0
    }
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
      <button id="accept">Accept All</button>
    </div>
    <script>document.getElementById('accept').addEventListener('click',()=>document.querySelector('.message-container').remove())</script>
  </body></html>`
  await page.setContent(html)
  await autoDismissConsent(page, { textPatterns: ['accept all'] })
  const overlay = await page.$('.message-container')
  assert.equal(overlay, null)
  await browser.close()
})

test('autoDismissConsent clicks "Accept All" buttons by default', async (t) => {
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
      <button id="accept">Accept All</button>
    </div>
    <script>document.getElementById('accept').addEventListener('click',()=>document.querySelector('.message-container').remove())</script>
  </body></html>`
  await page.setContent(html)
  // use default consent patterns from helpers
  const { consent } = setDefaultOptions()
  await autoDismissConsent(page, consent)
  const overlay = await page.$('.message-container')
  assert.equal(overlay, null)
  await browser.close()
})

test('autoDismissConsent removes cross-origin consent iframes', async (t) => {
  let browser
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    return
  }
  const page = await browser.newPage()
  const html = `<!doctype html><html><body>
    <iframe id="consent-frame" src="https://example.com" style="position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:10000;"></iframe>
  </body></html>`
  await page.setContent(html)
  await autoDismissConsent(page)
  const iframe = await page.$('#consent-frame')
  assert.equal(iframe, null)
  await browser.close()
})

test('autoDismissConsent removes overlays added after invocation', async (t) => {
  let browser
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    return
  }
  const page = await browser.newPage()
  await page.setContent('<!doctype html><html><body></body></html>')
  // Start dismissal before overlay exists
  await autoDismissConsent(page)
  // Inject overlay shortly after
  await page.evaluate(() => {
    setTimeout(() => {
      const o = document.createElement('div')
      o.id = 'late-overlay'
      o.className = 'consent-banner'
      o.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#f00;z-index:10000;'
      document.body.appendChild(o)
    }, 100)
  })
  await new Promise(resolve => setTimeout(resolve, 500))
  const overlay = await page.$('#late-overlay')
  assert.equal(overlay, null)
  await browser.close()
})

test('autoDismissConsent removes overlays added after 2 seconds', async (t) => {
  let browser
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    return
  }
  const page = await browser.newPage()
  await page.setContent('<!doctype html><html><body></body></html>')
  const { consent } = setDefaultOptions()
  await autoDismissConsent(page, consent)
  await page.evaluate(() => {
    setTimeout(() => {
      const o = document.createElement('div')
      o.id = 'very-late-overlay'
      o.className = 'consent-banner'
      o.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#0f0;z-index:10000;'
      document.body.appendChild(o)
    }, 2000)
  })
  await new Promise(resolve => setTimeout(resolve, 3500))
  const overlay = await page.$('#very-late-overlay')
  assert.equal(overlay, null)
  await browser.close()
})

test('injectTcfApi sets __tcfapi with provided tcString', async (t) => {
  let browser
  try {
    browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-setuid-sandbox'] })
  } catch (err) {
    t.skip('puppeteer unavailable: ' + err.message)
    return
  }
  const page = await browser.newPage()
  await injectTcfApi(page, { tcString: 'teststring' })
  await page.goto('data:text/html,<html><body>hi</body></html>')
  const res = await page.evaluate(() => new Promise(resolve => {
    window.__tcfapi('getTCData', 2, (d, s) => resolve({ d, s }))
  }))
  assert.equal(res.s, true)
  assert.equal(res.d.tcString, 'teststring')
  await browser.close()
})
