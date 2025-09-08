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

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok) throw new Error(`Fetch failed ${res.status} for ${url}`)
  return await res.text()
}

function extractFromRSS(xml) {
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
