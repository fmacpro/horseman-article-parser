import fs from 'fs'
import path from 'path'
import { parseArticle } from '../index.js'
import blockedResourceTypes from '../scripts/inc/blockResourceTypes.js'
import skippedResources from '../scripts/inc/skipResources.js'
import { applyDomainTweaks, loadTweaksConfig, applyUrlRewrites } from './inc/applyDomainTweaks.js'

function readUrls(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`URLs file not found: ${filePath}`)
  const text = fs.readFileSync(filePath, 'utf8')
  return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
}

async function run(urlsFile, outCsv = 'candidates_with_url.csv', start = 0, limit = null, concurrency = 1) {
  const all = readUrls(urlsFile)
  const end = limit ? Math.min(all.length, start + Number(limit)) : all.length
  const urls = all.slice(Number(start) || 0, end)
  console.log(`Crawling ${urls.length} URLs (slice ${start}-${end - 1}), dumping candidates to ${outCsv}${Number(concurrency) > 1 ? ` [concurrency=${concurrency}]` : ''}`)

  const quiet = Number(concurrency) > 1
  const tweaksConfig = loadTweaksConfig()

  function normalizeForCrawl(u) {
    try { return new URL(u).toString() } catch { return u }
  }

  const retriesDefault = Number(process.env.BATCH_RETRIES || 2)
  const gotoTimeoutDefault = Number(process.env.GOTO_TIMEOUT || 60000)

  async function processOne(url) {
    // Apply URL rewrites from config before normalization
    const rewritten = applyUrlRewrites(url, tweaksConfig)
    const normUrl = normalizeForCrawl(rewritten)
    const options = {
      url: normUrl,
      enabled: ['links'],
      blockedResourceTypes: blockedResourceTypes,
      skippedResources: skippedResources,
      contentDetection: {
        minLength: 400,
        maxLinkDensity: 0.5,
        debugDump: { path: outCsv, topN: 5, addUrl: true }
      },
      puppeteer: {
        launch: {
          headless: true,
          defaultViewport: null,
          handleSIGINT: false,
          ignoreHTTPSErrors: true,
          args: [
            '--no-sandbox', 
            '--disable-setuid-sandbox', 
            '--ignore-certificate-errors',
            '--disable-infobars',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-position=0,0'
          ]
        },
        goto: { waitUntil: 'networkidle2', timeout: gotoTimeoutDefault },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
      }
    }

    // Apply standardized per-domain tweaks from config
    const overrides = applyDomainTweaks(normUrl, options, tweaksConfig, { retries: retriesDefault, gotoTimeout: gotoTimeoutDefault })
    const retryMax = Number.isFinite(Number(overrides.retries)) ? Number(overrides.retries) : retriesDefault

    let attempt = 0
    while (attempt <= retryMax) {
      try {
        if (!quiet) console.log(`Fetching: ${normUrl}`)
        const socket = quiet ? { emit: () => {} } : undefined
        await parseArticle(options, socket)
        if (quiet) console.log(`Parsed: ${normUrl}`)
        return
      } catch (err) {
        attempt++
        if (attempt > retryMax) {
          if (quiet) {
            console.log(`Failed: ${normUrl}`)
          } else {
            console.error(`Error processing ${url}: ${err.message}`)
          }
          return
        }
        // Backoff before retry
        const delay = 1000 * attempt
        if (!quiet) console.log(`Retrying (${attempt}/${retryMax}) ${normUrl} after ${delay}ms ...`)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }

  if (Number(concurrency) <= 1) {
    for (const url of urls) {
      // sequential
      await processOne(url)
    }
  } else {
    // concurrent pool
    const pool = Math.max(1, Number(concurrency) || 1)
    let idx = 0
    const runNext = async () => {
      while (true) {
        const i = idx++
        if (i >= urls.length) return
        await processOne(urls[i])
      }
    }
    await Promise.all(Array.from({ length: pool }, runNext))
  }
}

const urlsFile = process.argv[2] || path.resolve('scripts/data/urls.txt')
const outCsv = process.argv[3] || path.resolve('scripts/data/candidates_with_url.csv')
const start = process.argv[4] || 0
const limit = process.argv[5] || null
const concurrency = process.argv[6] || process.env.BATCH_CONCURRENCY || 1
run(urlsFile, outCsv, start, limit, concurrency).catch(err => { console.error(err); throw err })
