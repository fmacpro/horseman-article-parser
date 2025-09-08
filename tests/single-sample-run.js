import { parseArticle } from '../index.js'
import { applyDomainTweaks, loadTweaksConfig, applyUrlRewrites } from '../scripts/inc/applyDomainTweaks.js'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import assert from 'assert'
import logger from '../controllers/logger.js'

/** add some names | https://observablehq.com/@spencermountain/compromise-plugins */
const testPlugin = function (Doc, world) {
  world.addWords({
    rishi: 'FirstName',
    sunak: 'LastName'
  })
}

// Allow passing a URL via CLI: `node tests/test.js <url>`
// With npm: `npm run test -- <url>`
const inputUrl = process.argv[2] || null

const options = {
  timeoutMs: Number(process.env.TEST_TIMEOUT_MS || 40000),
  url: inputUrl || 'https://www.bbc.co.uk/news/articles/cnvryg271ymo?at_medium=RSS&at_campaign=rss',
  enabled: ['links', 'sentiment', 'entities', 'spelling', 'keywords', 'siteicon'],
  // In tests, lightly block heavy resources (keep images)
  blockedResourceTypes: ['media', 'font', 'stylesheet'],
  // Tune content detection thresholds and dump candidate features for training
  contentDetection: {
    minLength: 400,
    maxLinkDensity: 0.5,
    debugDump: {
      path: 'scripts/data/candidates_with_url.csv',
      topN: 5,
      addUrl: true
    }
  },
  // Exercise spelling tweaks: include end positions and offsets
  retextspell: {
    tweaks: {
      ignoreUrlLike: true,
      includeEndPosition: true,
      includeOffsets: true
    }
  },
  // No domain-specific rules to keep logic generic
  nlp: {
    plugins: [testPlugin]
  },
  puppeteer: {
    launch: {
      headless: true,
      defaultViewport: null,
      handleSIGINT: false,
      ignoreHTTPSErrors: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--ignore-certificate-errors']
    },
    // Optional: pass user agent and headers for sites that gate content
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
    extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9' }
  }
}

// Optionally load reranker weights from weights.json
try {
  if (fs.existsSync('weights.json')) {
    const weights = JSON.parse(fs.readFileSync('weights.json', 'utf8'))
    options.contentDetection = options.contentDetection || {}
    options.contentDetection.reranker = { enabled: true, weights }
  }
} catch {
  // no weights.json provided
}

// Apply crawl tweaks (rewrites, headers, goto, consent clicks, interception) from scripts/crawl-tweaks.json
try {
  const tweaks = loadTweaksConfig()
  if (tweaks) {
    // Apply URL rewrites first
    const rewritten = applyUrlRewrites(options.url, tweaks)
    if (rewritten) options.url = rewritten
    // Apply per-domain option tweaks
    applyDomainTweaks(options.url, options, tweaks, { retries: 0 })
  }
} catch {
  // ignore tweak loading errors
}

const __dirname = path.dirname(fileURLToPath(import.meta.url))

;(async () => {
  try {
    const article = await parseArticle(options)
    assert.ok(article.title.text, 'article title missing')

    const response = {
      title: article.title.text,
      bodySelector: article.bodySelector,
      bodyXPath: article.bodyXPath,
      excerpt: article.excerpt,
      metadescription: article.meta.description.text,
      url: article.url,
      siteicon: article.siteicon,
      sentiment: { score: article.sentiment.score, comparative: article.sentiment.comparative },
      keyphrases: article.processed.keyphrases,
      keywords: article.processed.keywords,
      people: article.people,
      orgs: article.orgs,
      places: article.places,
      text: {
        raw: article.processed.text.raw,
        formatted: article.processed.text.formatted,
        html: article.processed.text.html
      },
      spelling: article.spelling,
      meta: article.meta,
      links: article.links,
      lighthouse: article.lighthouse,
      html: article.html
    }

    // Remove URLs from raw text for test output
    try {
      const stripUrls = (s) => {
        if (!s || typeof s !== 'string') return s
        // Remove protocol URLs and www.-prefixed
        let out = s.replace(/(?:https?:\/\/|ftp:\/\/)[^\s]+/gi, ' ')
        out = out.replace(/\bwww\.[^\s]+/gi, ' ')
        // Remove bare domains like example.com/path
        out = out.replace(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,})(?:\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]*)?/gi, ' ')
        return out.replace(/\s{2,}/g, ' ').trim()
      }
      response.text.raw = stripUrls(response.text.raw)
    } catch {}

    const json = JSON.stringify(response, null, 4)

    // Write results into tests/results with per-run filename including URL and timestamp
    const resultsDir = path.join(__dirname, 'results')
    await fs.promises.mkdir(resultsDir, { recursive: true })

    const ts = new Date()
    const pad = (n) => String(n).padStart(2, '0')
    const dd = pad(ts.getDate())
    const mm = pad(ts.getMonth() + 1)
    const yy = String(ts.getFullYear()).slice(-2)
    const hh = pad(ts.getHours())
    const mi = pad(ts.getMinutes())
    const ss = pad(ts.getSeconds())
    const timestamp = `${dd}-${mm}-${yy}-${hh}-${mi}-${ss}`
    const urlForName = (response.url || options.url || 'unknown')
    const sanitize = (s) => String(s)
      .replace(/^https?:\/\//i, '')
      .replace(/[^A-Za-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 120)
    const fileName = `testresults_${timestamp}__${sanitize(urlForName)}.json`
    const outPath = path.join(resultsDir, fileName)

    await fs.promises.writeFile(outPath, json, 'utf8')
    logger.info('Results written to', outPath)
  } catch (error) {
    logger.error(error.message)
    logger.error(error.stack)
    throw error
  }
})()
