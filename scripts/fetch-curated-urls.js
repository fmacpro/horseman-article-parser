/* eslint-disable n/no-unsupported-features/node-builtins */
import fs from 'fs'
import path from 'path'
import { XMLParser } from 'fast-xml-parser'

// Reads newline-delimited feed URLs from a text file.
// - ignores blank lines and lines starting with '#'
function readFeedsFile(filePath) {
  const p = path.isAbsolute(filePath) ? filePath : path.resolve(filePath)
  if (!fs.existsSync(p)) throw new Error(`Feeds file not found: ${p}`)
  const text = fs.readFileSync(p, 'utf8')
  return text
    .split(/\r?\n/)
    .map(s => s.trim())
    .filter(s => s && !s.startsWith('#'))
}

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

async function collect(count, feeds) {
  // Fetch per-feed links first
  const perFeed = []
  for (const f of feeds) {
    try {
      const xml = await fetchText(f)
      const isSitemap = /<urlset[\s>]/i.test(xml)
      const links = (isSitemap ? extractFromSitemap(xml) : extractFromRSS(xml))
        .map(normalizeUrl)
        .filter(keepLikelyArticles)
      perFeed.push(uniq(links))
    } catch {
      // ignore individual feed errors
      perFeed.push([])
    }
  }

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
  const target = Number(process.argv[2] || 1000)
  const feedsPath = process.argv[3] || process.env.FEEDS_FILE || path.resolve('scripts/data/feeds.txt')
  const feeds = readFeedsFile(feedsPath)
  const urls = await collect(target, feeds)
  if (urls.length < target) {
    console.warn(`Collected ${urls.length} URLs (< ${target}). Consider adding or updating feeds in ${feedsPath}`)
  }
  const outDir = path.resolve('scripts/data')
  try { fs.mkdirSync(outDir, { recursive: true }) } catch {}
  const outFile = path.join(outDir, 'urls.txt')
  fs.writeFileSync(outFile, urls.join('\n') + '\n', 'utf8')
  console.log(`Wrote ${urls.length} curated URLs to ${outFile}`)
}

main().catch(err => { console.error(err); throw err })
