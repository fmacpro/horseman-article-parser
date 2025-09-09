import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

puppeteer.use(StealthPlugin())

import logger from '../controllers/logger.js'

const url = process.argv[2]
const selectorArg = process.argv[3]
const selector = selectorArg || 'div.post-body.entry-content, #postBody, .entry-content'

if (!url) {
  logger.error('Usage: node scripts/extract-selector.js <url> [css-selector]')
  process.exitCode = 1
} else {
  ;(async () => {
  const browser = await puppeteer.launch({
    headless: true,
    defaultViewport: null,
    handleSIGINT: false,
    ignoreHTTPSErrors: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--ignore-certificate-errors',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--window-position=0,0'
    ]
  })
  try {
    const page = await browser.newPage()
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36')
    await page.setExtraHTTPHeaders({ 'Accept-Language': 'en-US,en;q=0.9' })

    // Load and try to trigger lazy content
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
    // Attempt a gentle scroll to trigger lazy content
    try {
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          const step = Math.max(200, Math.floor(window.innerHeight * 0.9))
          let scrolled = 0
          const maxScroll = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
          const timer = setInterval(() => {
            const before = window.scrollY
            window.scrollBy(0, step)
            scrolled += Math.abs(window.scrollY - before)
            if (window.scrollY + window.innerHeight >= maxScroll || scrolled > maxScroll * 1.5) {
              clearInterval(timer)
              resolve()
            }
          }, 150)
        })
      })
    } catch {}

    // Wait for selector (fallback to a few seconds)
    try { await page.waitForSelector(selector, { timeout: 10000 }) } catch {}

    const info = await page.evaluate((sel) => {
      const el = document.querySelector(sel)
      if (!el) return { present: false }
      const text = el.innerText || el.textContent || ''
      return {
        present: true,
        length: text.length,
        preview: text.slice(0, 800)
      }
    }, selector)

    if (!info.present) {
      logger.info(`Selector not found: ${selector}`)
    } else {
      logger.info(`Selector found: ${selector}`)
      logger.info(`Text length: ${info.length}`)
      logger.info('--- Preview ---')
      logger.info(info.preview)
    }
  } catch (err) {
    logger.error('Error:', err.message)
    process.exitCode = 1
  } finally {
    try { await browser.close() } catch {}
  }
  })()
}
