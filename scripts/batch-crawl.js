import fs from 'fs'
import path from 'path'
import { parseArticle } from '../index.js'
import blockedResourceTypes from '../scripts/inc/blockResourceTypes.js'
import skippedResources from '../scripts/inc/skipResources.js'
import { applyDomainTweaks, loadTweaksConfig, applyUrlRewrites } from './inc/applyDomainTweaks.js'
import logger from '../controllers/logger.js'
import { fileURLToPath } from 'url'
import { parseArgs } from 'node:util'

export function makeBar(pct) {
  const w = Math.max(5, Math.min(100, Number(process.env.PROGRESS_BAR_WIDTH || 16)))
  const filled = Math.max(0, Math.min(w, Math.round((pct / 100) * w)))
  const empty = w - filled
  return `[${'#'.repeat(filled)}${'.'.repeat(empty)}]`
}

export function readUrls(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`URLs file not found: ${filePath}`)
  const text = fs.readFileSync(filePath, 'utf8')
  return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
}

export function uniqueByHost(urls, limit = Infinity) {
  const out = []
  const seen = new Set()
  for (const u of urls) {
    try {
      const h = new URL(u).host
      if (seen.has(h)) continue
      seen.add(h)
      out.push(u)
      if (out.length >= limit) break
    } catch {}
  }
  return out
}
export async function run(urlsFile, outCsv = 'candidates_with_url.csv', start = 0, limit = null, concurrency = 1, uniqueHosts = false) {
  let all = readUrls(urlsFile)
  if (uniqueHosts) all = uniqueByHost(all)
  const end = limit ? Math.min(all.length, Number(start) + Number(limit)) : all.length
  const urls = all.slice(Number(start) || 0, end)

  const progressOnly = process.env.PROGRESS_ONLY ? process.env.PROGRESS_ONLY !== '0' : false
  const quiet = progressOnly // suppress per-URL logs when using progress bar
  const tweaksConfig = loadTweaksConfig()
  const t0 = Date.now()
  let processed = 0
  let okCount = 0
  let errCount = 0
  let startedCount = 0

  if (!progressOnly) {
    logger.info(`Crawling ${urls.length} URLs (slice ${start}-${end - 1}), dumping candidates to ${outCsv}${Number(concurrency) > 1 ? ` [concurrency=${concurrency}]` : ''}`)
  }

  function normalizeForCrawl(u) {
    try { return new URL(u).toString() } catch { return u }
  }

  // Baked-in aggressive defaults (override via env vars)
  const retriesDefault = Number(process.env.BATCH_RETRIES || 4)
  const gotoTimeoutDefault = Number(process.env.GOTO_TIMEOUT || 20000)
  const totalTimeoutDefault = Number(process.env.TOTAL_TIMEOUT_MS || 30000)

  async function processOne(url) {
    // Apply URL rewrites from config before normalization
    const rewritten = applyUrlRewrites(url, tweaksConfig)
    const normUrl = normalizeForCrawl(rewritten)
    startedCount++
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
        goto: { waitUntil: 'domcontentloaded', timeout: gotoTimeoutDefault },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
        extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
      }
    }
    // Total operation timeout per URL
    options.timeoutMs = Number.isFinite(Number(options.timeoutMs)) ? options.timeoutMs : totalTimeoutDefault

    // Apply standardized per-domain tweaks from config
    const overrides = applyDomainTweaks(normUrl, options, tweaksConfig, { retries: retriesDefault, gotoTimeout: gotoTimeoutDefault })
    const retryMax = Number.isFinite(Number(overrides.retries)) ? Number(overrides.retries) : retriesDefault

    let attempt = 0
    while (attempt <= retryMax) {
      try {
        const socket = quiet ? { emit: () => {} } : undefined
        // On the final retry, relax constraints to improve success odds
        if (attempt === retryMax) {
          try {
            options.noInterception = true
            if (options.puppeteer && options.puppeteer.goto) {
              // Switch to networkidle2 and longer timeout for final try
              options.puppeteer.goto = { waitUntil: 'networkidle2', timeout: Math.max(60000, (options.puppeteer.goto.timeout || 0)) }
            }
            options.timeoutMs = Math.max(90000, Number(options.timeoutMs || 0))
            // Provide content wait selectors to help dynamic blogs render
            options.contentWaitSelectors = [
              'article','main','[role="main"]','.entry-content','.post-body','#postBody','.post-content','.article-content'
            ]
            options.contentWaitTimeoutMs = 15000
            options.extraScrollPass = true
          } catch { /* ignore */ }
        }
        await parseArticle(options, socket)
        return true
      } catch (err) {
        attempt++
        if (attempt > retryMax) {
          return false
        }
        // Backoff before retry
        const delay = 1000 * attempt
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }

  let prevPct = -1
  function updateProgress() {
    const pct = urls.length ? Math.round((processed / urls.length) * 100) : 100
    if (pct !== prevPct) {
      const elapsed = Math.round((Date.now() - t0) / 1000)
      const inflight = Math.max(0, Math.min(Number(concurrency) || 1, startedCount - processed))
      const bar = makeBar(pct)
      logger.info(`[batch] ${bar} ${pct}% | ${processed}/${urls.length} done | ok:${okCount} err:${errCount} inflight:${inflight} | ${elapsed}s elapsed`)
      prevPct = pct
    }
  }

  if (Number(concurrency) <= 1) {
    for (const url of urls) {
      const ok = await processOne(url)
      processed++
      if (ok) okCount++
      else errCount++
      updateProgress()
    }
  } else {
    // concurrent pool
    const pool = Math.max(1, Number(concurrency) || 1)
    let idx = 0
    const runNext = async () => {
      while (true) {
        const i = idx++
        if (i >= urls.length) return
        const ok = await processOne(urls[i])
        processed++
        if (ok) okCount++
        else errCount++
        updateProgress()
      }
    }
    await Promise.all(Array.from({ length: pool }, runNext))
  }
  try {
    const pct = 100
    const bar = makeBar(pct)
    const elapsed = Math.round((Date.now() - t0) / 1000)
    logger.info(`[batch] ${bar} ${pct}% | ${urls.length}/${urls.length} done | ok:${okCount} err:${errCount} inflight:0 | ${elapsed}s elapsed`)
  } catch {}
}

const isCli =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isCli) {
  const { values } = parseArgs({
    options: {
      'urls-file': { type: 'string', default: path.resolve('scripts/data/urls.txt') },
      'out-file': { type: 'string', default: path.resolve('scripts/data/candidates_with_url.csv') },
      start: { type: 'string', default: '0' },
      limit: { type: 'string' },
      concurrency: { type: 'string', default: process.env.BATCH_CONCURRENCY || '1' },
      'unique-hosts': { type: 'boolean', default: !!process.env.UNIQUE_HOSTS }
    }
  })
  const urlsFile = values['urls-file']
  const outCsv = values['out-file']
  const start = Number(values.start)
  const limit = values.limit != null ? Number(values.limit) : null
  const concurrency = Number(values.concurrency)
  const uniqueHosts = values['unique-hosts']
  run(urlsFile, outCsv, start, limit, concurrency, uniqueHosts).catch(err => { logger.error(err); throw err })
}
