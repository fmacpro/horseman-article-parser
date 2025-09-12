import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'
puppeteer.use(StealthPlugin())

import fs from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'
import { setDefaultOptions } from '../helpers.js'
import { autoDismissConsent } from '../controllers/consent.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const url = process.argv[2] || 'https://www.theguardian.com/world/2025/sep/12/israels-strike-on-hamas-leaders-in-qatar-shatters-gulfs-faith-in-us-protection'

async function main () {
  const outDir = path.join(__dirname, '..', 'overrides', 'debug')
  try { await fs.mkdir(outDir, { recursive: true }) } catch {}

  const options = setDefaultOptions({
    url,
    consent: { autoDismiss: true, observerTimeoutMs: 4000 },
    puppeteer: {
      launch: {
        headless: true,
        defaultViewport: { width: 1366, height: 900 },
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--window-size=1366,900'
        ]
      },
      goto: { waitUntil: 'domcontentloaded', timeout: 8000 }
    }
  })

  const browser = await puppeteer.launch(options.puppeteer.launch)
  const page = await browser.newPage()
  try {
    // Speed up, basic headers
    await page.setExtraHTTPHeaders({ Referer: 'https://www.google.com/' })
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    )

    await page.goto(options.url, options.puppeteer.goto)

    // Take an initial screenshot to confirm banner presence
    const beforePath = path.join(outDir, 'guardian-consent-before.png')
    await page.screenshot({ path: beforePath, fullPage: false })

    // Try our auto-dismiss logic
    await autoDismissConsent(page, options.consent)

    // Small settle wait
    await new Promise(resolve => setTimeout(resolve, 500))

    // After screenshot
    const afterPath = path.join(outDir, 'guardian-consent-after.png')
    await page.screenshot({ path: afterPath, fullPage: false })

    console.log('Saved screenshots:')
    console.log(' -', beforePath)
    console.log(' -', afterPath)
  } finally {
    await browser.close()
  }
}

main().catch(err => { console.error(err); process.exit(1) })
