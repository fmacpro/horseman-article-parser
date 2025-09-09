 
import fs from 'fs'
import path from 'path'
import { XMLParser } from 'fast-xml-parser'
import { ProxyAgent, setGlobalDispatcher } from 'undici'
import logger, { createLogger } from '../controllers/logger.js'
import { fileURLToPath } from 'url'
import { parseArgs } from 'node:util'

// Enable proxy support when HTTP(S)_PROXY env vars are present
const proxy =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy
if (proxy) {
  try { setGlobalDispatcher(new ProxyAgent(proxy)) } catch {}
}

// Reads newline-delimited feed URLs from a text file.
// - ignores blank lines and lines starting with '#'
export function readFeedsFile(filePath) {
  const p = path.isAbsolute(filePath) ? filePath : path.resolve(filePath)
  if (!fs.existsSync(p)) throw new Error(`Feeds file not found: ${p}`)
  const text = fs.readFileSync(p, 'utf8')
  return text
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('#'))
}

export function uniq(arr) { return Array.from(new Set(arr)) }

export function defaultHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
    'Accept': 'application/rss+xml, application/atom+xml, text/xml, application/xml;q=0.9, */*;q=0.5',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache'
  }
}

export function normalizeUrl(u) {
  try { return new URL(u).toString() } catch { return null }
}

export function keepLikelyArticles(url) {
  if (!url) return false
  let obj
  try { obj = new URL(url) } catch { return false }
  // Only allow http(s)
  if (!/^https?:$/.test(obj.protocol)) return false
  const u = url.toLowerCase()
  const path = obj.pathname || '/'
  const segments = path.split('/').filter(Boolean)
  const last = segments[segments.length - 1] || ''

  // Exclude obvious non-articles
  if (u.includes('/live/') || u.includes('/video') || u.includes('/podcast')) return false
  if (u.endsWith('.xml') || u.endsWith('.rss') || u.endsWith('.atom')) return false

  // Drop homepages and shallow index pages
  if (path === '/' || path === '') return false
  // Common index/section pages
  const sectionNames = new Set(['news', 'blog', 'blogs', 'articles', 'stories', 'index', 'category'])
  if (segments.length === 1 && sectionNames.has(segments[0])) return false

  // Heuristics for article-like slugs
  const looksDated = /\/(19|20)\d{2}\/[01]?\d\//.test(path) // /YYYY/MM/
  const hasSlug = /[-_]/.test(last) || (last.length >= 8 && /[a-z]/.test(last))
  if (!looksDated && !hasSlug && segments.length < 2) return false

  return true
}

export async function fetchTextOnce(url, timeoutMs = 12000, headers = defaultHeaders()) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs))
  try {
    const res = await fetch(url, { redirect: 'follow', signal: ctrl.signal, headers })
    if (!res.ok) {
      const ct = res.headers?.get ? (res.headers.get('content-type') || '') : ''
      throw new Error(`Fetch failed ${res.status} (${ct}) for ${url}`)
    }
    return await res.text()
  } finally { clearTimeout(t) }
}

export async function fetchText(url, timeoutMs = 12000, maxRetries = 2) {
  let lastErr
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const broaden = attempt > 0
      const headers = defaultHeaders()
      if (broaden) headers.Accept = 'application/xml, text/xml, text/html;q=0.8, */*;q=0.5'
      return await fetchTextOnce(url, timeoutMs + attempt * 1000, headers)
    } catch (err) {
      lastErr = err
      const s = String(err && (err.message || err))
      const transient = /(429|502|503|504|network|timeout|abort)/i.test(s)
      if (attempt < maxRetries && transient) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)))
        continue
      }
      break
    }
  }
  throw lastErr
}

export function extractFromRSS(xml) {
  const parser = new XMLParser({ ignoreAttributes: false })
  const j = parser.parse(xml)
  const links = []

  const textFrom = (node) => {
    if (!node) return null
    if (typeof node === 'string') return node
    if (typeof node === 'object') return node['#text'] || node['@_href'] || node['@_url'] || null
    return null
  }

  const pickItemLink = (node) => {
    if (!node) return null
    if (Array.isArray(node)) {
      const alt = node.find(l => (l['@_rel'] || '').toLowerCase() === 'alternate' && textFrom(l)) || node[0]
      return textFrom(alt)
    }
    return textFrom(node)
  }

  // Determine channel/homepage link to avoid pushing it as an item URL
  let channelLink = null
  if (j?.rss?.channel?.link) {
    channelLink = textFrom(j.rss.channel.link)
  } else if (j?.feed?.link) {
    const feedLink = j.feed.link
    if (Array.isArray(feedLink)) {
      const alt = feedLink.find(l => (l['@_rel'] || '').toLowerCase() === 'alternate' && textFrom(l)) || feedLink[0]
      channelLink = textFrom(alt)
    } else {
      channelLink = textFrom(feedLink)
    }
  }
  const normChannel = normalizeUrl(channelLink)

  const items = j?.rss?.channel?.item || j?.feed?.entry || []
  const arr = Array.isArray(items) ? items : [items]
  for (const it of arr) {
    if (!it) continue
    const linkStr = pickItemLink(it.link)
    const guidStr = textFrom(it.guid)
    const idStr = textFrom(it.id)
    const normItem = normalizeUrl(linkStr)

    // Prefer GUID when item link equals channel/homepage URL
    if (normChannel && normItem && normChannel === normItem) {
      if (typeof guidStr === 'string') links.push(guidStr)
      else if (typeof idStr === 'string') links.push(idStr)
    } else {
      if (typeof linkStr === 'string') links.push(linkStr)
      if (typeof guidStr === 'string') links.push(guidStr)
      else if (typeof idStr === 'string') links.push(idStr)
    }
  }
  return links
}

export function extractFromSitemap(xml) {
  const parser = new XMLParser({ ignoreAttributes: false })
  const j = parser.parse(xml)
  const urls = j?.urlset?.url || []
  const arr = Array.isArray(urls) ? urls : [urls]
  const links = []
  for (const u of arr) {
    if (typeof u?.loc === 'string') links.push(u.loc)
  }
  return links
}

export function makeBar(pct, width = 16) {
  const w = Math.max(5, Math.min(100, Number(width)))
  const filled = Math.max(0, Math.min(w, Math.round((pct / 100) * w)))
  const empty = w - filled
  return `[${'#'.repeat(filled)}${'.'.repeat(empty)}]`
}

export async function collect(count, feeds, {
  progressOnly = false,
  feedConcurrency = 6,
  feedTimeoutMs = 12000,
  barWidth = 16,
  quiet = false
} = {}) {
  // Concurrently fetch per-feed links
  const FEED_CONCURRENCY = Number(feedConcurrency)
  const FEED_TIMEOUT_MS = Number(feedTimeoutMs)
  logger.setQuiet(quiet || progressOnly)
  const progressLogger = createLogger({ quiet })
  const detailLogger = createLogger({ quiet: quiet || progressOnly })
  const start = Date.now()
  const perFeed = new Array(feeds.length)
  let processed = 0
  let succeeded = 0
  let failed = 0
  let nextIndex = 0
  const started = new Set()
  progressLogger.info(`[feeds] starting - total: ${feeds.length} concurrency: ${FEED_CONCURRENCY} timeout: ${FEED_TIMEOUT_MS}ms`)

  async function worker() {
    while (true) {
      const i = nextIndex++
      if (i >= feeds.length) return
      const f = feeds[i]
      try {
        started.add(i)
        const xml = await fetchText(f, FEED_TIMEOUT_MS)
        const looksSitemap = /<urlset[\s>]/i.test(xml)
        const looksRss = /<(rss|feed)[\s>]/i.test(xml)
        if (!(looksSitemap || looksRss)) throw new Error('not xml/rss (html or empty)')
        const links = (looksSitemap ? extractFromSitemap(xml) : extractFromRSS(xml))
          .map(normalizeUrl)
          .filter(keepLikelyArticles)
        perFeed[i] = uniq(links)
        succeeded++
        detailLogger.info(`[feeds] OK ${i + 1}/${feeds.length} - ${looksSitemap ? 'sitemap' : 'rss'} items:${perFeed[i].length}`)
      } catch (err) {
        failed++
        perFeed[i] = []
        detailLogger.warn(`[feeds] ERR ${i + 1}/${feeds.length} - ${err?.message || err}`)
      } finally {
        processed++
        updateProgress()
      }
    }
  }

  const workers = Array.from({ length: Math.min(FEED_CONCURRENCY, feeds.length) }, () => worker())
  let prevPct = -1
  function updateProgress() {
    const pct = feeds.length ? Math.round((processed / feeds.length) * 100) : 100
    if (pct !== prevPct) {
      const elapsed = Math.round((Date.now() - start) / 1000)
      const inflight = Math.max(0, Math.min(feeds.length, started.size - processed))
      const bar = makeBar(pct, barWidth)
      progressLogger.info(`[feeds] ${bar} ${pct}% | ${processed}/${feeds.length} done | ok:${succeeded} err:${failed} inflight:${inflight} | ${elapsed}s elapsed`)
      prevPct = pct
    }
  }
  await Promise.all(workers).catch(() => {})
  updateProgress()
  const elapsed = Math.round((Date.now() - start) / 1000)
  try {
    const pct = 100
    const bar = makeBar(pct, barWidth)
    progressLogger.info(`[feeds] ${bar} ${pct}% | ${feeds.length}/${feeds.length} done | ok:${succeeded} err:${failed} inflight:0 | ${elapsed}s elapsed`)
  } catch {}
  progressLogger.info(`[feeds] complete - total: ${feeds.length} ok: ${succeeded} err: ${failed} in ${elapsed}s`)

  // Round-robin selection across feeds to maximize diversity
  const selected = []
  const seen = new Set()
  let addedInPass = true
  while (selected.length < count && addedInPass) {
    addedInPass = false
    for (let i = 0; i < perFeed.length && selected.length < count; i++) {
      const arr = perFeed[i]
      while (arr.length) {
        const next = arr.shift()
        if (!next || seen.has(next)) continue
        selected.push(next)
        seen.add(next)
        addedInPass = true
        break
      }
    }
  }

  return selected
}

async function main() {
  const { values } = parseArgs({
    options: {
      count: { type: 'string', default: '1000' },
      'feeds-file': { type: 'string', default: path.resolve('scripts/data/feeds.txt') },
      'progress-only': { type: 'boolean', default: false },
      'feed-concurrency': { type: 'string', default: '6' },
      'feed-timeout': { type: 'string', default: '12000' },
      'bar-width': { type: 'string', default: '16' },
      'quiet': { type: 'boolean', default: false }
    }
  })
  const target = Number(values.count)
  const feedsPath = values['feeds-file']
  const progressOnly = values['progress-only']
  const feedConcurrency = Number(values['feed-concurrency'])
  const feedTimeoutMs = Number(values['feed-timeout'])
  const barWidth = Number(values['bar-width'])
  const quiet = values.quiet
  logger.setQuiet(quiet || progressOnly)
  const cliLogger = createLogger()
  const feeds = readFeedsFile(feedsPath)
  const urls = await collect(target, feeds, { progressOnly, feedConcurrency, feedTimeoutMs, barWidth, quiet })
  if (urls.length < target) {
    cliLogger.warn(`Collected ${urls.length} URLs (< ${target}). Consider adding or updating feeds in ${feedsPath}`)
  }
  const outDir = path.resolve('scripts/data')
  try { fs.mkdirSync(outDir, { recursive: true }) } catch {}
  const outFile = path.join(outDir, 'urls.txt')
  fs.writeFileSync(outFile, urls.join('\n') + '\n', 'utf8')
  cliLogger.info(`Wrote ${urls.length} curated URLs to ${outFile}`)
}

const isCli =
  process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isCli) {
  main().catch(err => {
    const cliLogger = createLogger()
    cliLogger.error(err)
    throw err
  })
}
