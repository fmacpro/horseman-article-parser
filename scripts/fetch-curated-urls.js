/* eslint-disable n/no-unsupported-features/node-builtins */
import fs from 'fs'
import path from 'path'
import { XMLParser } from 'fast-xml-parser'

const FEEDS = [
  // News
  'https://www.theguardian.com/world/rss',
  'https://www.theguardian.com/business/rss',
  'https://feeds.bbci.co.uk/news/world/rss.xml',
  'https://feeds.bbci.co.uk/news/technology/rss.xml',
  'http://rss.cnn.com/rss/cnn_topstories.rss',
  'https://www.aljazeera.com/xml/rss/all.xml',
  'https://www.reuters.com/finance/markets/rss',
  // Tech media
  'https://www.theverge.com/rss/index.xml',
  'https://www.wired.com/feed/rss',
  'http://feeds.arstechnica.com/arstechnica/index',
  'http://feeds.feedburner.com/TechCrunch/',
  'https://www.engadget.com/rss.xml',
  'https://www.theregister.com/headlines.atom',
  'https://feed.infoq.com/',
  // Company/engineering blogs
  'https://blog.cloudflare.com/rss/',
  'https://martinfowler.com/feed.atom',
  'https://developers.googleblog.com/atom.xml',
  'https://nodejs.org/en/feed/blog.xml',
  'https://v8.dev/blog.atom',
  'https://developer.chrome.com/feeds/blog.xml',
  'https://stackoverflow.blog/feed/',
  'https://www.smashingmagazine.com/feed/',
  // Docs sitemaps
  'https://developer.mozilla.org/sitemaps/en-US/sitemap.xml'
]

function uniq(arr) { return Array.from(new Set(arr)) }

function normalizeUrl(u) {
  try { return new URL(u).toString() } catch { return null }
}

function keepLikelyArticles(url) {
  if (!url) return false
  const u = url.toLowerCase()
  // Exclude obvious non-articles
  if (u.includes('/live/') || u.includes('/video') || u.includes('/podcast')) return false
  if (u.endsWith('.xml') || u.endsWith('.rss') || u.endsWith('.atom')) return false
  return true
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`)
  return await res.text()
}

function extractFromRSS(xml) {
  const parser = new XMLParser({ ignoreAttributes: false })
  const j = parser.parse(xml)
  const links = []
  const items = j?.rss?.channel?.item || j?.feed?.entry || []
  const arr = Array.isArray(items) ? items : [items]
  for (const it of arr) {
    if (!it) continue
    let link = it.link
    if (typeof link === 'object') {
      link = link['@_href'] || link['#text'] || link['@_url']
    }
    if (typeof link === 'string') links.push(link)
    if (typeof it.guid === 'string') links.push(it.guid)
  }
  return links
}

function extractFromSitemap(xml) {
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

async function collect(count) {
  const out = []
  for (const f of FEEDS) {
    try {
      const xml = await fetchText(f)
      const isSitemap = /<urlset[\s>]/i.test(xml)
      const links = isSitemap ? extractFromSitemap(xml) : extractFromRSS(xml)
      for (const l of links) out.push(normalizeUrl(l))
    } catch {
      // ignore individual feed errors
    }
  }
  const filtered = uniq(out.filter(keepLikelyArticles)).slice(0, count)
  return filtered
}

async function main() {
  const target = Number(process.argv[2] || 1000)
  const urls = await collect(target)
  if (urls.length < target) {
    console.warn(`Collected ${urls.length} URLs (< ${target}). Consider adding more feeds in scripts/fetch-curated-urls.js`)
  }
  fs.writeFileSync(path.resolve('urls.txt'), urls.join('\n') + '\n', 'utf8')
  console.log(`Wrote ${urls.length} curated URLs to urls.txt`)
}

main().catch(err => { console.error(err); throw err })
