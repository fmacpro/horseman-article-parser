import fs from 'fs'
import path from 'path'
import { parseArticle } from '../index.js'
import { applyDomainTweaks, loadTweaksConfig, applyUrlRewrites } from './inc/applyDomainTweaks.js'
import logger from '../controllers/logger.js'

// Lightweight HTTP helpers using global fetch (Node >=18)
export function defaultHeaders(u) {
  const h = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Cache-Control': 'no-cache'
  }
  try {
    const host = new URL(u).host
    // Some hosts are picky; keep defaults but allow future per-domain tweaks
    if (host.endsWith('openai.com')) {
      h['Accept'] = 'text/html,*/*'
    }
  } catch {}
  return h
}

export async function httpHead(url, timeoutMs = 3000) {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow', signal: ctrl.signal, headers: defaultHeaders(url) })
    return { ok: res.ok, status: res.status }
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message || err) }
  } finally { clearTimeout(t) }
}

export async function httpProbe(url, timeoutMs = 3000) {
  // Some sites 405 on HEAD; fall back to a very short GET
  const head = await httpHead(url, timeoutMs)
  if (head.ok || head.status === 405) return head
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: ctrl.signal, headers: defaultHeaders(url) })
    return { ok: res.ok, status: res.status }
  } catch (err) {
    return { ok: false, status: 0, error: String(err?.message || err) }
  } finally { clearTimeout(t) }
}

export function readUrls(filePath) {
  const p = path.isAbsolute(filePath) ? filePath : path.resolve(filePath)
  if (!fs.existsSync(p)) throw new Error(`URLs file not found: ${p}`)
  const text = fs.readFileSync(p, 'utf8')
  return text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
}

export function uniq(arr) { return Array.from(new Set(arr)) }

function now() { return Date.now() }

export function uniqueByHost(urls, limit) {
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

export function ampCandidates(raw) {
  try {
    const u = new URL(raw)
    const c = []
    const path = u.pathname.endsWith('/') ? u.pathname : (u.pathname + '/')
    c.push(u.origin + path + 'amp')
    c.push(u.origin + path + 'amp.html')
    c.push(u.origin + u.pathname + (u.search ? u.search + '&' : '?') + 'amp=1')
    c.push(u.origin + u.pathname + (u.search ? u.search + '&' : '?') + 'output=amp')
    return c
  } catch {
    return []
  }
}

export function skipUrl(u) {
  try {
    const url = new URL(u)
    const host = url.host
    const path = url.pathname || ''
    // Only handle http(s)
    if (!/^https?:$/.test(url.protocol)) return 'skip: non-http(s) scheme'
    // Skip obvious non-HTML resources by extension
    if (/\.(pdf|docx?|pptx?|xlsx?|zip|gz|rar|7z|tar|mp3|mp4|avi|mov|wmv)$/i.test(path)) return 'skip: non-html resource'
    // Some mailing list archives consistently 403 robots
    if (host.endsWith('lists.ding.net')) return 'skip: forbidden archive'
    // Known ephemeral galleries without consistent AMP
    if (host.endsWith('aljazeera.com') && path.startsWith('/gallery/')) return 'skip: aljazeera gallery'
  } catch {}
  return null
}

export function buildOptions(url, timeoutMs, base = {}) {
  return {
    url,
    timeoutMs,
    enabled: ['links','sentiment','entities','spelling','keywords','siteicon'],
    blockedResourceTypes: base.blockedResourceTypes || ['media','font','stylesheet'],
    noInterception: !!base.noInterception,
    puppeteer: {
      launch: {
        headless: true,
        defaultViewport: null,
        handleSIGINT: false,
        ignoreHTTPSErrors: true,
        args: ['--no-sandbox','--disable-setuid-sandbox','--ignore-certificate-errors']
      },
      goto: base.goto || undefined,
      javascriptEnabled: base.javascriptEnabled,
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36',
      extraHTTPHeaders: { 'Accept-Language': 'en-US,en;q=0.9', ...(base.extraHTTPHeaders || {}) }
    },
    contentDetection: { minLength: 400, maxLinkDensity: 0.5 }
  }
}

export function makeSocket(quiet) {
  if (quiet) return { emit: () => {} }
  // Filter noisy logs to reduce pipe errors while still showing progress
  return {
    emit: (type, status) => {
      try {
        const s = String(status || '')
        if (/^\[parse\] (start|complete)/.test(s) || s.includes('live blog detected') || s.startsWith('[rescue]') || s.startsWith('[clean]')) {
          logger.info(s)
        }
      } catch {}
    }
  }
}

export async function tryParse(url, tweaks, timeoutMs, overrides, quiet) {
  const opts = buildOptions(url, timeoutMs, overrides)
  applyDomainTweaks(url, opts, tweaks, { retries: 0 })
  const socket = makeSocket(quiet)
  return await parseArticle(opts, socket)
}

export function classifyError(msg) {
  const s = String(msg || '').toLowerCase()
  if (/timeout/.test(s)) return 'timeout'
  if (/403|forbidden/.test(s)) return 'forbidden'
  if (/consent|cookie|gdpr/.test(s)) return 'consent'
  if (/execution context|detached frame|session closed|target closed/.test(s)) return 'context'
  return 'generic'
}

export async function runOne(url, tweaks, timeoutMs = 20000, quiet = true) {
  const t0 = now()
  const rewritten = applyUrlRewrites(url, tweaks) || url
  // Pre-skip known problematic URLs
  const skipReason = skipUrl(rewritten)
  if (skipReason) {
    return { ok: false, url, dt: now() - t0, error: skipReason, kind: 'skip', attempts: [] }
  }
  // Preflight 4xx to avoid expensive parse on dead links
  try {
    const pre = await httpProbe(rewritten, Math.min(4000, timeoutMs))
    if (!pre.ok && pre.status >= 400 && pre.status < 500 && pre.status !== 405) {
      return { ok: false, url, dt: now() - t0, error: `preflight ${pre.status}`, kind: 'http4xx', attempts: [] }
    }
  } catch {}
  let lastErr = null
  const attempts = []
  // Attempt 1: baseline
  try {
    const a1 = await tryParse(rewritten, tweaks, timeoutMs, {}, quiet)
    const dt = now() - t0
    const raw = (a1?.processed?.text?.raw || '')
    const size = raw.length
    const words = raw ? raw.trim().split(/\s+/).filter(Boolean).length : 0
    const links = Array.isArray(a1?.links) ? a1.links.length : 0
    const source = /\bamp(=1|\.[a-z]+)?$/i.test(String(a1?.url || '')) ? 'amp' : 'dynamic'
    if (size > 0) return { ok: true, url, finalUrl: a1?.url || rewritten, dt, size, words, links, source, attempt: 'base' }
    attempts.push({ step: 'base', size })
    lastErr = new Error('no_content')
  } catch (e1) { lastErr = e1; attempts.push({ step: 'base', error: String(e1?.message || e1) }) }

  // Attempt 2: no interception + networkidle2
  try {
    const a2 = await tryParse(rewritten, tweaks, timeoutMs, { noInterception: true, goto: { waitUntil: 'networkidle2', timeout: Math.min(timeoutMs, 10000) } }, quiet)
    const dt = now() - t0
    const raw = (a2?.processed?.text?.raw || '')
    const size = raw.length
    const words = raw ? raw.trim().split(/\s+/).filter(Boolean).length : 0
    const links = Array.isArray(a2?.links) ? a2.links.length : 0
    const source = /\bamp(=1|\.[a-z]+)?$/i.test(String(a2?.url || '')) ? 'amp' : 'dynamic'
    if (size > 0) return { ok: true, url, finalUrl: a2?.url || rewritten, dt, size, words, links, source, attempt: 'no-intercept' }
    attempts.push({ step: 'no-intercept', size })
    lastErr = new Error('no_content')
  } catch (e2) { lastErr = e2; attempts.push({ step: 'no-intercept', error: String(e2?.message || e2) }) }

  // Attempt 3: JavaScript disabled
  try {
    const a3 = await tryParse(rewritten, tweaks, timeoutMs, { javascriptEnabled: false, noInterception: true }, quiet)
    const dt = now() - t0
    const raw = (a3?.processed?.text?.raw || '')
    const size = raw.length
    const words = raw ? raw.trim().split(/\s+/).filter(Boolean).length : 0
    const links = Array.isArray(a3?.links) ? a3.links.length : 0
    const source = /\bamp(=1|\.[a-z]+)?$/i.test(String(a3?.url || '')) ? 'amp' : 'dynamic'
    if (size > 0) return { ok: true, url, finalUrl: a3?.url || rewritten, dt, size, words, links, source, attempt: 'no-js' }
    attempts.push({ step: 'no-js', size })
    lastErr = new Error('no_content')
  } catch (e3) { lastErr = e3; attempts.push({ step: 'no-js', error: String(e3?.message || e3) }) }

  // Attempt 4: AMP variants directly (gate with quick probe)
  for (const amp of ampCandidates(rewritten)) {
    try {
      const probe = await httpProbe(amp, Math.min(3000, Math.max(1500, Math.floor(timeoutMs/10))))
      if (!(probe.ok || probe.status === 405)) { attempts.push({ step: 'amp-direct', error: `probe ${probe.status||0}` }); continue }
      const a4 = await tryParse(amp, tweaks, timeoutMs, { noInterception: true }, quiet)
      const dt = now() - t0
      const raw = (a4?.processed?.text?.raw || '')
      const size = raw.length
      const words = raw ? raw.trim().split(/\s+/).filter(Boolean).length : 0
      const links = Array.isArray(a4?.links) ? a4.links.length : 0
      if (size > 0) return { ok: true, url, finalUrl: a4?.url || amp, dt, size, words, links, source: 'amp', attempt: 'amp-direct' }
      attempts.push({ step: 'amp-direct', size })
      lastErr = new Error('no_content')
    } catch (e4) { lastErr = e4; attempts.push({ step: 'amp-direct', error: String(e4?.message || e4) }) }
  }

  const dt = now() - t0
  const errMsg = String(lastErr?.message || lastErr || 'unknown error')
  const kind = classifyError(errMsg)
  return { ok: false, url, dt, error: errMsg, kind, attempts }
}

async function main() {
  const defaultUrlsFile = path.resolve('scripts/data/urls.txt')
  const args = process.argv.slice(2)
  const [NArg, concurrencyArg, urlsArg, timeoutArg] = args.slice(-4)
  const N = Number(NArg ?? 100)
  const concurrency = Number(concurrencyArg ?? 5)
  const urlsFile = urlsArg ? path.resolve(urlsArg) : defaultUrlsFile
  const timeoutMs = Number(timeoutArg ?? 20000)
  const quiet = process.env.SAMPLE_VERBOSE ? false : (concurrency > 1)

  const tweaks = loadTweaksConfig()
  let urls = uniq(readUrls(urlsFile))
  if (process.env.UNIQUE_HOSTS) urls = uniqueByHost(urls, N)
  if (!process.env.UNIQUE_HOSTS && urls.length > N) urls = urls.slice(0, N)

  const results = []
  let idx = 0
  const started = new Set()

  // Progress ticker
  const t0 = now()
  logger.info(`[sample] starting - total: ${urls.length} concurrency: ${concurrency} timeout: ${timeoutMs}ms`)
  const progressOnly = !!process.env.SAMPLE_PROGRESS_ONLY
  const barWidth = Number(process.env.SAMPLE_BAR_WIDTH || 16)
  const makeBar = (pct) => {
    const w = Math.max(5, Math.min(100, Math.floor(barWidth)))
    const filled = Math.max(0, Math.min(w, Math.round((pct / 100) * w)))
    const empty = w - filled
    return `[${'#'.repeat(filled)}${'.'.repeat(empty)}]`
  }
  let prevPct = -1
  const tick = setInterval(() => {
    try {
      const done = results.filter(r => r != null).length
      const ok = results.filter(r => r && r.ok).length
      const skips = results.filter(r => r && !r.ok && r.kind === 'skip').length
      const err = results.filter(r => r && !r.ok && r.kind !== 'skip').length
      const inflight = Math.max(0, Math.min(concurrency, urls.length - done))
      const pct = urls.length ? Math.round((done / urls.length) * 100) : 0
      const elapsed = Math.round((now() - t0) / 1000)
      if (pct !== prevPct) {
        const bar = makeBar(pct)
        logger.info(`[progress] ${bar} ${pct}% | ${done}/${urls.length} done | ok:${ok} skip:${skips} err:${err} inflight:${inflight} | ${elapsed}s elapsed`)
        prevPct = pct
      }
    } catch {}
  }, Number(process.env.SAMPLE_TICK_MS || 2000))
  async function worker() {
    while (true) {
      const i = idx++
      if (i >= urls.length) return
      const u = urls[i]
      started.add(i)
      if (!progressOnly) logger.info(`[sample] parsing ${i+1}/${urls.length} - ${u}`)
      const res = await runOne(u, tweaks, timeoutMs, quiet)
      results[i] = res
      const tag = res.ok ? 'OK' : (res?.kind === 'skip' ? 'SKIP' : 'ERR')
      if (!progressOnly) {
        if (quiet) {
          if (tag === 'ERR') logger.info(`[sample] Failed: ${u} - ${res.error}`)
          if (tag === 'SKIP') logger.info(`[sample] Skipped: ${u} - ${res.error || 'skip'}`)
        } else {
          logger.info(`[sample] ${tag} ${i+1}/${urls.length} url: ${u}`)
        }
      }
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, worker)
  await Promise.all(workers)
  clearInterval(tick)

  const ok = results.filter(r => r && r.ok)
  const skips = results.filter(r => r && !r.ok && r.kind === 'skip')
  const err = results.filter(r => r && !r.ok && r.kind !== 'skip')
  try {
    const pct = 100
    const bar = makeBar(pct)
    const elapsed = Math.round((now() - t0) / 1000)
    logger.info(`[progress] ${bar} ${pct}% | ${urls.length}/${urls.length} done | ok:${ok.length} skip:${skips.length} err:${err.length} inflight:0 | ${elapsed}s elapsed`)
  } catch {}
  logger.info(`[sample] complete - total: ${results.length} ok: ${ok.length} skip: ${skips.length} err: ${err.length}`)

  const outDir = path.resolve('scripts/results')
  try { fs.mkdirSync(outDir, { recursive: true }) } catch {}
  const ts = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${pad(ts.getDate())}-${pad(ts.getMonth()+1)}-${String(ts.getFullYear()).slice(-2)}-${pad(ts.getHours())}-${pad(ts.getMinutes())}-${pad(ts.getSeconds())}`
  // Build aggregates
  const byHost = {}
  for (const r of results) {
    if (!r) continue
    let host = ''
    try { host = new URL(r.finalUrl || r.url).host } catch { host = '' }
    byHost[host] = byHost[host] || { host, total: 0, ok: 0, skip: 0, err: 0, dtSum: 0 }
    byHost[host].total++
    if (r.ok) {
      byHost[host].ok++
      byHost[host].dtSum += (r.dt || 0)
    } else if (r.kind === 'skip') {
      byHost[host].skip++
    } else {
      byHost[host].err++
    }
  }
  const ampCount = results.filter(r => r && r.ok && r.source === 'amp').length
  const dynamicCount = results.filter(r => r && r.ok && r.source === 'dynamic').length

  const summary = {
    when: ts.toISOString(), N, concurrency, timeoutMs,
    totals: { total: results.length, ok: ok.length, skip: skips.length, err: err.length },
    sources: { amp: ampCount, dynamic: dynamicCount },
    byHost: Object.values(byHost).map(h => ({ ...h, avgMs: h.ok ? Math.round(h.dtSum / h.ok) : null }))
  }

  // Write JSON summary
  const jsonFile = path.join(outDir, `sample_summary_${stamp}.json`)
  fs.writeFileSync(jsonFile, JSON.stringify({ ...summary, results }, null, 2), 'utf8')
  logger.info(`[sample] wrote summary to ${jsonFile}`)

  // Write CSV rows
  const csvFile = path.join(outDir, `sample_summary_${stamp}.csv`)
  const header = 'url,final_url,ok,source,elapsed_ms,size,words,links,error' + '\n'
  const rows = results.map(r => {
    const esc = (s) => {
      const v = (s == null ? '' : String(s))
      return /[,\n"]/.test(v) ? ('"' + v.replace(/"/g, '""') + '"') : v
    }
    return [esc(r?.url), esc(r?.finalUrl || ''), r?.ok ? 1 : 0, r?.source || '', r?.dt || '', r?.size || '', r?.words || '', r?.links || '', esc(r?.error || '')].join(',')
  })
  fs.writeFileSync(csvFile, header + rows.join('\n') + '\n', 'utf8')
  logger.info(`[sample] wrote CSV to ${csvFile}`)

  // Write host breakdown CSV
  const hostCsv = path.join(outDir, `sample_hosts_${stamp}.csv`)
  const hHeader = 'host,total,ok,skip,err,avg_ms' + '\n'
  const hRows = Object.values(byHost).map(h => [h.host, h.total, h.ok, (h.skip||0), h.err, (h.ok ? Math.round(h.dtSum / h.ok) : '')].join(','))
  fs.writeFileSync(hostCsv, hHeader + hRows.join('\n') + '\n', 'utf8')
  logger.info(`[sample] wrote host breakdown to ${hostCsv}`)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => { logger.error(err); process.exit(1) })
}
