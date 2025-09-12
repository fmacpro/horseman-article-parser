import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

puppeteer.use(StealthPlugin())

import fs from 'fs'
import Sentiment from 'sentiment'
import nlp from 'compromise'
import absolutify from 'absolutify'
import { JSDOM, VirtualConsole } from 'jsdom'
import { extractStructuredData } from './controllers/structuredData.js'
import { detectContent } from './controllers/contentDetector.js'
import jquery from 'jquery'
import { createRequire } from 'module'
import { setDefaultOptions, capitalizeFirstLetter } from './helpers.js'
import keywordParser from './controllers/keywordParser.js'
import lighthouseAnalysis from './controllers/lighthouse.js'
import spellCheck from './controllers/spellCheck.js'
import logger from './controllers/logger.js'
import { autoDismissConsent, injectTcfApi } from './controllers/consent.js'
import { buildLiveBlogSummary } from './controllers/liveBlog.js'
import { getRawText, getFormattedText, getHtmlText, htmlCleaner } from './controllers/textProcessing.js'
import { sanitizeDataUrl } from './controllers/utils.js'
import { safeAwait, sleep } from './controllers/async.js'
import { timeLeftFactory, waitForFrameStability, navigateWithFallback } from './controllers/navigation.js'
import { loadNlpPlugins } from './controllers/nlpPlugins.js'
import { fetch as undiciFetch } from 'undici'

const require = createRequire(import.meta.url)

/**
 * main article parser module export function
 *
 * @param {Object} options - the options object
 * @param {Object} socket - the optional socket
 *
 * @return {Object} article parser results object
 *
 */

export async function parseArticle (options, socket = { emit: (type, status) => logger.info(status) }) {

  options = setDefaultOptions(options)
  if (
    options.puppeteer?.launch?.javascriptEnabled === false &&
    typeof options.url === 'string' && options.url.startsWith('data:text/html')
  ) {
    const { sanitizedUrl } = sanitizeDataUrl(options.url, false)
    options.url = sanitizedUrl
    options.puppeteer.launch.javascriptEnabled = true
  }
  // Heuristic: bump timeout slightly for URLs that look like live pages
  try {
    const u = String(options.url || '')
    if (/\b(live|live-news|liveblog|minute-by-minute)\b/i.test(u)) {
      const base = Number(options.timeoutMs || 0)
      if (Number.isFinite(base)) options.timeoutMs = base + 5000
    }
  } catch (err) {
    logger.warn('timeout heuristic failed', err)
  }

  const pluginHints = loadNlpPlugins(options)
  options.__pluginHints = pluginHints

  if (Number.isFinite(options.timeoutMs) && options.timeoutMs < 50) {
    throw new Error(`Timeout after ${options.timeoutMs}ms`)
  }

  const browser = await puppeteer.launch(options.puppeteer.launch)

  // Global timeout support for the whole parse operation
  const totalTimeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : null
  const startAt = Date.now()
  const deadline = totalTimeoutMs ? startAt + totalTimeoutMs : null
  if (deadline) options.__deadline = deadline
  let timeoutHandle = null
  const timeoutPromise = new Promise((_resolve, reject) => {
    if (!totalTimeoutMs) return
    timeoutHandle = setTimeout(async () => {
      await safeAwait(browser.close(), 'browser.close on timeout')
      reject(new Error(`Timeout after ${totalTimeoutMs}ms`))
    }, totalTimeoutMs)
  })

  const work = (async () => {
    try {
      const article = await articleParser(browser, options, socket)

      if (options.enabled.includes('lighthouse')) {
        article.lighthouse = await lighthouseAnalysis(browser, options, socket)
      }

      return article
    } finally {
      // always close browser if not already; safe to call twice
      await safeAwait(browser.close(), 'browser.close final')
    }
  })()

  try {
    const result = totalTimeoutMs ? await Promise.race([work, timeoutPromise]) : await work
    return result
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}

/**
 * article scraping function
 *
 * @param {Object} options - the options object
 * @param {Object} socket - the optional socket
 *
 * @return {Object} article parser results object
 *
 */

const articleParser = async function (browser, options, socket) {
  const article = {}
  article.meta = {}
  article.meta.title = {}
  article.links = []
  article.title = {}
  article.excerpt = ''
  article.processed = {}
  article.processed.text = {}
  article.lighthouse = {}
  const pluginHints = options.__pluginHints || { first: [], last: [] }

  const log = (phase, msg, fields = {}) => {
    try {
      const fmtVal = (k, v) => {
        if (v == null) return ''
        if (/(_ms)$/.test(k) && Number.isFinite(Number(v))) {
          const s = Number(v) / 1000
          return `${s.toFixed(1)}s`
        }
        const str = String(v)
        if (/^https?:\/\//i.test(str) && str.length > 120) {
          return str.slice(0, 100) + '…' + str.slice(-16)
        }
        return str
      }
      const header = `[${phase}] ${msg}`
      const ctx = Object.entries(fields)
        .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${fmtVal(k, v)}`)
        .join(' | ')
      socket.emit('parse:status', ctx ? `${header} - ${ctx}` : header)
    } catch (err) {
      logger.warn('log emit failed', err)
    }
  }
  const t0 = Date.now()
  const elapsed = () => Date.now() - t0
  log('parse', 'start', { url: options.url, timeout_ms: options.timeoutMs || '' })
  const page = await browser.newPage()

  try {
    if (options.consent?.injectTcfApi) {
      try { await injectTcfApi(page, options.consent) } catch (err) { logger.warn('injectTcfApi failed', err) }
    }
    // Track frame navigations to wait for brief stability before evaluating
    page.__lastNavAt = Date.now()
    try {
      page.on('framenavigated', () => { page.__lastNavAt = Date.now() })
      page.on('load', () => { page.__lastNavAt = Date.now() })
      page.on('domcontentloaded', () => { page.__lastNavAt = Date.now() })
    } catch (err) {
      logger.warn('failed to attach frame listeners', err)
    }

    // Allow static HTML override (e.g., fetched AMP) when dynamic content is obstructed
    let staticHtmlOverride = null
    let staticUrlOverride = null
    let ampFetchPromise = null
    let contentOverridden = false

    const timeLeft = timeLeftFactory(options)
    const tl = () => Math.max(0, timeLeft())
    await safeAwait(page.setDefaultTimeout(Math.min(5000, Math.max(2500, tl()))), 'setDefaultTimeout')
    await safeAwait(page.setDefaultNavigationTimeout(Math.min(8000, Math.max(3500, tl()))), 'setDefaultNavigationTimeout')

    // Optional: disable JavaScript for troublesome sites (via tweaks)
    try {
      const jsSetting = options.puppeteer &&
        (typeof options.puppeteer.javascriptEnabled === 'boolean'
          ? options.puppeteer.javascriptEnabled
          : options.puppeteer.launch && typeof options.puppeteer.launch.javascriptEnabled === 'boolean'
              ? options.puppeteer.launch.javascriptEnabled
              : undefined)
      if (typeof jsSetting === 'boolean') {
        await page.setJavaScriptEnabled(jsSetting)
      }
    } catch (err) {
      logger.warn('setJavaScriptEnabled failed', err)
    }
    const jsEnabled = !(options.puppeteer && options.puppeteer.javascriptEnabled === false)

    // Ignore content security policies
    await safeAwait(page.setBypassCSP(options.puppeteer.setBypassCSP), 'setBypassCSP')

    // Optional: set user agent and extra headers from options
    if (options.puppeteer && options.puppeteer.userAgent) {
      await safeAwait(page.setUserAgent(options.puppeteer.userAgent), 'setUserAgent')
    }
    if (options.puppeteer && options.puppeteer.extraHTTPHeaders) {
      const hdrs = { ...options.puppeteer.extraHTTPHeaders }
      if (!('Referer' in hdrs)) hdrs.Referer = 'https://www.google.com/'
      await safeAwait(page.setExtraHTTPHeaders(hdrs), 'setExtraHTTPHeaders')
    } else {
      await safeAwait(page.setExtraHTTPHeaders({ Referer: 'https://www.google.com/' }), 'setExtraHTTPHeaders')
    }

    const interceptionActive = { current: false }
    let reqTotal = 0
    let reqBlocked = 0
    let reqSkipped = 0
    let reqContinued = 0
    if (!options.noInterception) {
      await page.setRequestInterception(true)
      interceptionActive.current = true
      try {
        log('intercept', 'enabled', {
          blocked: (options.blockedResourceTypes || []).join(',') || '(none)',
          skipped: (options.skippedResources || []).slice(0, 5).join(',') || '(none)'
        })
      } catch (err) {
        logger.warn('intercept logging failed', err)
      }

      const blockedResourceTypes = new Set(options.blockedResourceTypes)
      const skippedResources = new Set(options.skippedResources)

      page.on('request', request => {
        reqTotal++
        let requestUrl
        try {
          const url = new URL(request.url())
          requestUrl = url.origin + url.pathname
        } catch {
          requestUrl = request.url()
        }
        const isBlockedType = blockedResourceTypes.has(request.resourceType())
        const isSkippedMatch = [...skippedResources].some(resource => requestUrl.includes(resource))
        if (interceptionActive.current && (isBlockedType || isSkippedMatch)) {
          if (isBlockedType) reqBlocked++
          else if (isSkippedMatch) reqSkipped++
          request.abort().catch(err => {
            if (!/interception is not enabled/i.test(err?.message)) {
              logger.warn('request.abort failed', err)
            }
          })
        } else if (interceptionActive.current) {
          reqContinued++
          request.continue().catch(err => {
            if (!/interception is not enabled/i.test(err?.message)) {
              logger.warn('request.continue failed', err)
            }
          })
        }
      })
    }

    // Inject jQuery from local package to avoid external network fetch
    const jquerySource = await fs.promises.readFile(
      require.resolve('jquery/dist/jquery.min.js'),
      'utf8'
    )
    await safeAwait(page.addScriptTag({ content: jquerySource }), 'addScriptTag')

    // Pre-seed cookies if provided (helps bypass consent walls)
    try {
      if (options.puppeteer && Array.isArray(options.puppeteer.cookies) && options.puppeteer.cookies.length) {
        await page.setCookie(...options.puppeteer.cookies)
      }
    } catch (err) {
      logger.warn('setCookie failed', err)
    }

    // Adaptive navigation with fallbacks to reduce need for per-domain tweaks
    let response = await navigateWithFallback(page, options, options.url, tl, log, interceptionActive)
    try { await waitForFrameStability(page, timeLeft, 400, 1500) } catch (err) { logger.warn('waitForFrameStability failed', err) }

    // Start background AMP/static fallback fetch in parallel
    try {
      const makeAmpCandidates = (raw) => {
        const u = new URL(raw)
        const c = []
        const path = u.pathname.endsWith('/') ? u.pathname : (u.pathname + '/')
        c.push(u.origin + path + 'amp')
        c.push(u.origin + path + 'amp.html')
        c.push(u.origin + u.pathname + (u.search ? u.search + '&' : '?') + 'amp=1')
        c.push(u.origin + u.pathname + (u.search ? u.search + '&' : '?') + 'output=amp')
        return c
      }
      const tryFetch = async (u) => {
        const res = await undiciFetch(u, {
          headers: {
            'User-Agent': options.puppeteer?.userAgent || 'Mozilla/5.0',
            'Accept-Language': options.puppeteer?.extraHTTPHeaders?.['Accept-Language'] || 'en-US,en;q=0.9',
            'Referer': 'https://www.google.com/'
          }
        })
        if (!res.ok) return null
        const txt = await res.text()
        if (!txt || txt.length < 1000) return null
        return txt
      }
      const candidates = makeAmpCandidates(options.url)
      ampFetchPromise = (async () => {
        for (const cu of candidates) {
          try {
            const txt = await tryFetch(cu)
            if (txt) { staticHtmlOverride = txt; staticUrlOverride = cu; log('amp', 'fetched', { url: cu }); break }
          } catch {}
        }
        if (staticHtmlOverride) log('amp', 'available')
      })()
    } catch { /* ignore background fetch errors */ }

    // Give AMP a brief head start; if ready, prefer static path and skip dynamic waits
    try {
      if (ampFetchPromise) {
        const earlyWait = Math.min(1000, Math.max(300, Math.floor(tl() * 0.2)))
        await Promise.race([ampFetchPromise, new Promise(resolve => setTimeout(resolve, earlyWait))])
      }
    } catch {}

  // Inject cookies if set
  if (typeof options.puppeteer.cookies !== 'undefined') {
    await page.setCookie(...options.puppeteer.cookies)
  }

  // Click buttons if defined (for dismissing privacy popups etc)
  if (!staticHtmlOverride && typeof options.clickelements !== 'undefined') {
    let clickelement = ''

    for (clickelement of options.clickelements) {
      if (await page.$(clickelement) !== null) {
        await page.click(clickelement)
      }
    }
  }

  // Attempt to auto-dismiss common consent popups/overlays across all frames
  if (!staticHtmlOverride && jsEnabled && options.consent && options.consent.autoDismiss) {
    await autoDismissConsent(page, options.consent)
  }
  try { await waitForFrameStability(page, timeLeft, 350, 1200) } catch (err) { logger.warn('waitForFrameStability failed', err) }

  // Wait briefly for common article/content selectors to appear (helps dynamic blogs)
  try {
    if (staticHtmlOverride) throw new Error('skip-dynamic-wait')
    const contentSelectors = options.contentWaitSelectors || [
      'article', 'main', '[role="main"]',
      '.entry-content', '.post-body', '#postBody', '.post-content', '.article-content'
    ]
    const selTimeout = Number.isFinite(Number(options.contentWaitTimeoutMs)) ? Number(options.contentWaitTimeoutMs) : 2500
    for (const sel of contentSelectors) {
      try { await page.waitForSelector(sel, { timeout: selTimeout }) ; break } catch {}
    }
  } catch {}

  // If page still lacks readable content, try a generic AMP/static fallback fetch
  try {
    const hasReadable = await page.evaluate(() => {
      const paras = Array.from(document.querySelectorAll('article p, main p, [role="main"] p, p'))
      let longCount = 0
      for (const p of paras) {
        const t = (p.textContent || '').replace(/\s+/g, ' ').trim()
        if (t.length >= 120) longCount++
        if (longCount >= 2) return true
      }
      return false
    })
    if (!hasReadable && tl() > 1500 && !staticHtmlOverride) {
      try {
        const makeAmpCandidates = (raw) => {
          const u = new URL(raw)
          const c = []
          const path = u.pathname.endsWith('/') ? u.pathname : (u.pathname + '/')
          c.push(u.origin + path + 'amp')
          c.push(u.origin + path + 'amp.html')
          c.push(u.origin + u.pathname + (u.search ? u.search + '&' : '?') + 'amp=1')
          c.push(u.origin + u.pathname + (u.search ? u.search + '&' : '?') + 'output=amp')
          return c
        }
        const tryFetch = async (u) => {
          const res = await undiciFetch(u, {
            headers: {
              'User-Agent': options.puppeteer?.userAgent || 'Mozilla/5.0',
              'Accept-Language': options.puppeteer?.extraHTTPHeaders?.['Accept-Language'] || 'en-US,en;q=0.9',
              'Referer': 'https://www.google.com/'
            }
          })
          if (!res.ok) return null
          const txt = await res.text()
          if (!txt || txt.length < 1000) return null
          return txt
        }
        const candidates = makeAmpCandidates(options.url)
        for (const cu of candidates) {
          try {
            const txt = await tryFetch(cu)
            if (txt) { staticHtmlOverride = txt; staticUrlOverride = cu; break }
          } catch {}
        }
        if (staticHtmlOverride) log('amp', 'using static fallback')
      } catch {}
    }
  } catch {}

  // Generic readable-content heuristic wait: paragraphs/headings/body text signals
  if (!options.skipReadabilityWait) {
    try {
      const maxMs = Math.min(2500, Math.max(800, tl()))
      await page.waitForFunction(() => {
        const scope = document.querySelector('article, main, [role="main"]') || document.body
        if (!scope) return false
        const paras = Array.from(scope.querySelectorAll('p'))
        const heads = scope.querySelector('h1, h2, h3')
        let longCount = 0
        let blocksOver80 = 0
        let totalText = 0
        for (const p of paras) {
          const t = (p.textContent || '').replace(/\s+/g, ' ').trim()
          totalText += t.length
          if (t.length >= 120) longCount++
          if (t.length >= 80) blocksOver80++
          if (longCount >= 2) return true
        }
        if (longCount >= 1 && !!heads) return true
        if (blocksOver80 >= 3) return true
        if (totalText >= 800) return true
        return false
      }, { timeout: maxMs })
      log('content', 'readable_signal')
    } catch {}
  }

  // If AMP fetched, prefer static override for speed and robustness
  try {
    if (ampFetchPromise) {
      const waitMs = Math.min(1500, Math.max(200, Math.floor(tl() * 0.3)))
      try { await Promise.race([ampFetchPromise, new Promise(resolve => setTimeout(resolve, waitMs))]) } catch {}
    }
    if (staticHtmlOverride) {
      article.url = staticUrlOverride || article.url
      article.html = staticHtmlOverride
      log('amp', 'switch_static')
    }
  } catch { /* ignore */ }

  // Try to trigger lazy-loaded content by scrolling (skip if JS disabled)
  try {
    if (staticHtmlOverride) throw new Error('skip-scroll')
    if (!jsEnabled) throw new Error('skip-scroll')
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
    // small settle delay
    await sleep(400)
    // Re-check preferred selectors after scroll
    const contentSelectors2 = options.contentWaitSelectors || [
      '.entry-content', '.post-body', '#postBody', '.post-content', '.article-content'
    ]
    for (const sel of contentSelectors2) {
      try { await page.waitForSelector(sel, { timeout: 1500 }) ; break } catch {}
    }
    // Optional second pass on final retry
    if (options.extraScrollPass) {
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          const step = Math.max(300, Math.floor(window.innerHeight))
          const start = Date.now()
          const maxMs = 3000
          const timer = setInterval(() => {
            window.scrollBy(0, step)
            if ((window.scrollY + window.innerHeight) >= Math.max(document.body.scrollHeight, document.documentElement.scrollHeight) || (Date.now() - start) > maxMs) {
              clearInterval(timer)
              resolve()
            }
          }, 120)
        })
      })
      await sleep(300)
      for (const sel of contentSelectors2) {
        try { await page.waitForSelector(sel, { timeout: 2000 }) ; break } catch {}
      }
    }
  } catch {}

  log('fetch', 'begin', { url: options.url, elapsed_ms: elapsed(), budget_ms: tl() })

  // Evaluate status (guard if response is null due to aborted navigations)
  try {
    const respObj = (response && typeof response.request === 'function' && response.request())
    const res = respObj && typeof respObj.response === 'function' && respObj.response()
    article.status = res && typeof res.status === 'function' ? res.status() : null
  } catch {
    article.status = null
  }

  log('fetch', 'status', { code: article.status, elapsed_ms: elapsed(), budget_ms: tl() })
  try { log('fetch', 'request summary', { total: reqTotal, blocked: reqBlocked, skipped: reqSkipped, continued: reqContinued }) } catch {}

  if (article.status === 403 || article.status === 404) {
    const message = 'Failed to fetch ' + options.url + ' ' + article.status
    log('fetch', 'failed', { code: article.status, url: options.url })
    throw new Error(message)
  }

  // Evaluate URL (fallback to page.url if response is unavailable)
  try {
    const respObj = (response && typeof response.request === 'function' && response.request())
    const res = respObj && typeof respObj.response === 'function' && respObj.response()
    article.url = res && typeof res.url === 'function' ? res.url() : page.url()
  } catch {
    article.url = page.url()
  }

  const pathArray = article.url.split('/')
  const protocol = pathArray[0]
  const host = pathArray[2]

  article.host = host
  article.baseurl = protocol + '//' + host

  // Evaluate title (retry once on context loss)
  try {
    article.meta.title.text = await page.title()
  } catch {
    try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 1500 }) } catch {}
    try { article.meta.title.text = await page.title() } catch { article.meta.title.text = '' }
  }

  // If the page/browser was closed (e.g., due to global timeout), abort gracefully
  try { if (page.isClosed && page.isClosed()) throw new Error('Page closed') } catch {}
  if (timeLeft() <= 0) throw new Error('Timeout budget exceeded')

  // Evaluate site icon url
  if (!staticHtmlOverride && options.enabled.includes('siteicon') && timeLeft() > 300) {
    log('analyze', 'Evaluating site icon')
    try {
      article.siteicon = await page.evaluate(() => {
        const candidates = [
          'link[rel~="icon"]',
          'link[rel="shortcut icon"]',
          'link[rel="icon"]',
          'link[rel="apple-touch-icon"]'
        ]
        for (const sel of candidates) {
          const el = document.querySelector(sel)
          if (el && el.href) return el.href
        }
        return null
      })
    } catch { article.siteicon = null }
  }
  if (timeLeft() <= 0) throw new Error('Timeout budget exceeded')

  // Helper: retry page.evaluate after navigation/context loss
  const isCtxError = (err) => {
    const msg = (err && err.message) || ''
    return /Execution context was destroyed|Cannot find context|Protocol error|detached Frame|Target closed|Session closed/i.test(msg)
  }
  const evalWithRetry = async (fn) => {
    try {
      return await fn()
    } catch (err) {
      if (timeLeft() <= 0) throw err
      if (!isCtxError(err)) throw err
      try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: Math.min(2000, Math.max(0, timeLeft())) }) } catch {}
      try { await waitForFrameStability(page, timeLeft, 400, 1500) } catch (err) { logger.warn('waitForFrameStability failed', err) }
      return await fn()
    }
  }

  // Evaluate meta
log('analyze', 'Evaluating meta tags')
  if (!staticHtmlOverride) {
    const meta = await evalWithRetry(async () => page.evaluate(() => {
      // Native DOM (robust across sites)
      const out = {}
      const nodes = document.querySelectorAll('meta')
      nodes.forEach(el => {
        const name = el.getAttribute('name')
        const prop = el.getAttribute('property')
        const content = el.getAttribute('content')
        if (name) out[name] = content
        else if (prop) out[prop] = content
      })
      return out
    }))
    Object.assign(article.meta, meta)
  } else {
    try {
      const vc0 = new VirtualConsole(); vc0.sendTo(console, { omitJSDOMErrors: true })
      const { window } = new JSDOM(staticHtmlOverride, { virtualConsole: vc0 })
      const out = {}
      const nodes = window.document.querySelectorAll('meta')
      nodes.forEach(el => {
        const name = el.getAttribute('name')
        const prop = el.getAttribute('property')
        const content = el.getAttribute('content')
        if (name) out[name] = content
        else if (prop) out[prop] = content
      })
      Object.assign(article.meta, out)
    } catch {}
  }

  // Assign meta description
  const metaDescription = article.meta.description
  article.meta.description = {}
  article.meta.description.text = metaDescription

  // If we landed on a consent/cookies/ privacy info page, retry once: re-open target URL and auto-dismiss consent
  try {
    const looksLikeConsent = (() => {
      const t = String(article.meta.title?.text || '').toLowerCase()
      return /(cookie|cookies|consent|privacy|gdpr)/i.test(t)
    })()
    if (!staticHtmlOverride && looksLikeConsent && timeLeft() > 1200) {
      log('consent', 'retry')
      try { await navigateWithFallback(page, options, options.url, tl, log, interceptionActive) } catch (err) { logger.warn('navigateWithFallback retry failed', err) }
      if (jsEnabled && options.consent && options.consent.autoDismiss) {
        try { await autoDismissConsent(page, options.consent) } catch (err) { logger.warn('autoDismissConsent failed', err) }
        try { await waitForFrameStability(page, timeLeft, 400, 1200) } catch (err) { logger.warn('waitForFrameStability failed', err) }
      }
      // If still consent-like, try once with JavaScript disabled to avoid dynamic consent flows
      let titleNow = ''
      try { titleNow = await page.title() } catch { titleNow = '' }
      if (/(cookie|cookies|consent|privacy|gdpr)/i.test(String(titleNow))) {
        try { await page.setJavaScriptEnabled(false) } catch (err) { logger.warn('setJavaScriptEnabled false failed', err) }
        try { await navigateWithFallback(page, options, options.url, tl, log, interceptionActive) } catch (err) { logger.warn('navigateWithFallback JS-disabled failed', err) }
        try { await waitForFrameStability(page, timeLeft, 400, 1200) } catch (err) { logger.warn('waitForFrameStability failed', err) }
      }
      // Refresh meta after retry
      const meta2 = await evalWithRetry(async () => page.evaluate(() => {
        const out = {}
        const nodes = document.querySelectorAll('meta')
        nodes.forEach(el => {
          const name = el.getAttribute('name')
          const prop = el.getAttribute('property')
          const content = el.getAttribute('content')
          if (name) out[name] = content
          else if (prop) out[prop] = content
        })
        return out
      }))
      Object.assign(article.meta, meta2)
    }
  } catch { /* ignore */ }

  // Take mobile screenshot after consent handling
  if (options.enabled.includes('screenshot') && timeLeft() > 300) {
    log('analyze', 'Capturing screenshot')
    try {
      if (!staticHtmlOverride && jsEnabled && options.consent && options.consent.autoDismiss) {
        try { await autoDismissConsent(page, options.consent) } catch (err) { logger.warn('autoDismissConsent before screenshot failed', err) }
        try { await page.waitForTimeout(500) } catch {}
      }
      article.screenshot = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 60 })
    } catch { /* ignore screenshot failures (e.g., page closed on timeout) */ }
  }

  // Save the original HTML of the document (use page.content for robustness)
  if (staticHtmlOverride) {
    if (staticUrlOverride) article.url = staticUrlOverride
    article.html = staticHtmlOverride
  } else {
    try {
      article.html = await evalWithRetry(async () => page.content())
    } catch {
      article.html = await evalWithRetry(async () => page.evaluate(() => document.documentElement.innerHTML))
    }
  }

  // HTML Cleaning
  let html
  if (staticHtmlOverride) {
    try {
      const vcC = new VirtualConsole(); vcC.sendTo(console, { omitJSDOMErrors: true })
      const { window } = new JSDOM(article.html, { virtualConsole: vcC })
      try {
        for (let i = 0; i < options.striptags.length; i++) {
          const sel = options.striptags[i]
          window.document.querySelectorAll(sel).forEach(el => { try { el.remove() } catch {} })
        }
      } catch {}
      html = window.document.documentElement.innerHTML
    } catch {
      html = article.html
    }
  } else {
    html = await evalWithRetry(async () => page.evaluate((options) => {
      // Native DOM removal (robust default)
      try {
        for (let i = 0; i < options.length; i++) {
          const sel = options[i]
          document.querySelectorAll(sel).forEach(el => { try { el.remove() } catch {} })
        }
      } catch {}
      return document.documentElement.innerHTML
    }, options.striptags))
  }

  // More HTML Cleaning (fallback to raw if cleaner fails)
  try {
    html = await htmlCleaner(html, options.cleanhtml)
  } catch (err) {
    log('clean', 'Cleaner failed; using raw HTML', { error: (err && err.message) || String(err) })
  }

  // Body Content Identification
  log('analyze', 'Evaluating detected content')

  // Readability options no longer used

  const vc1 = new VirtualConsole()
  vc1.sendTo(console, { omitJSDOMErrors: true })
  const dom = new JSDOM(html, { virtualConsole: vc1 })

  // Legacy readability prep removed; using structured/heuristic detection instead

  // Generic live-blog detector: build a concise summary from timestamped updates
  let liveOverride = null
  try {
    const live = buildLiveBlogSummary(dom.window.document)
    if (live && live.ok) {
      liveOverride = live.html
      log('content', 'live blog detected; using summary', { entries: live.count || '', chars: live.chars || '' })
      try {
        article.meta = article.meta || {}
        article.meta.liveSummary = { used: true, entries: Number(live.count || 0), chars: Number(live.chars || 0) }
      } catch {}
    }
  } catch {}
  // Meta-based fallback for live stories when detector fails
  try {
    if (!liveOverride) {
      const mt = (article.meta && (article.meta['template_type'] || article.meta['type'] || '')) + ''
      if (/live/i.test(mt)) {
        const scope = dom.window.document.querySelector('main, article, [role="main"]') || dom.window.document.body
        const paras = Array.from(scope ? scope.querySelectorAll('p') : []).map(p => (p.textContent || '').replace(/\s+/g,' ').trim()).filter(t => t.length > 60).slice(0, 5)
        if (paras.length >= 2) {
          const html = ['<div class="live-summary">']
          for (const pv of paras) html.push('<div class="entry"><p>' + pv + '</p></div>')
          html.push('</div>')
          liveOverride = html.join('')
          log('content', 'live blog detected; using summary', { entries: paras.length })
          try {
            article.meta = article.meta || {}
            article.meta.liveSummary = { used: true, entries: paras.length }
          } catch {}
        }
      }
    }
  } catch {}

  // Derived Title & Content (structured-data aware detector always enabled)
  const sd = extractStructuredData(dom.window.document)
  const detected = detectContent(dom.window.document, options, sd)
  const { detectTitle } = await import('./controllers/titleDetector.js')
  article.title.text = detectTitle(dom.window.document, sd) || article.title.text
  const isLiveSummary = !!liveOverride
  let content = liveOverride || detected.html
  if (liveOverride) {
    article.bodySelector = '.live-summary'
    article.bodyXPath = "/HTML/BODY/DIV[@class=\"live-summary\"]"
  } else {
    article.bodySelector = detected.selector || null
    article.bodyXPath = detected.xpath || null
  }

  if (!content) {
    // As a last resort, use full body HTML
    if (dom.window.document.body) {
      content = dom.window.document.body.innerHTML
      if (!article.bodySelector) article.bodySelector = 'body'
      if (!article.bodyXPath) article.bodyXPath = '/HTML/BODY'
    } else {
      content = html
    }
  }

  // Emit body container details as early as possible, after content detection/fallback
  try {
    log('content', 'body container', { selector: (article.bodySelector || '(not detected)') })
    log('content', 'body container xpath', { xpath: (article.bodyXPath || '(not detected)') })
  } catch { /* ignore */ }

  // Title & Content based on defined config rules (skip when using static fallback)
  if (!staticHtmlOverride && options.rules ) {

    let rules = options.rules;

    for ( let i = 0; i < rules.length; i++ ) {

      if ( article.host === rules[i].host ) {

        if ( rules[i].title ) {

          article.title.text = await page.evaluate( rules[i].title )

        }

        if ( rules[i].content ) {
          try {
            const override = await page.evaluate(rules[i].content)
            if (override && typeof override === 'string') {
              content = override
              contentOverridden = true
            }
          } catch { /* leave content as-is */ }
        }

      }

    }

  }

  // Turn relative links into absolute links & assign processed html
  article.processed.html = await absolutify(content, article.baseurl)

  // Get in article links
  if (options.enabled.includes('links')) {
    log('analyze', 'Evaluating in-article links')

    const vc2 = new VirtualConsole()
    vc2.sendTo(console, { omitJSDOMErrors: true })
    const { window } = new JSDOM(article.processed.html, { virtualConsole: vc2 })
    const $ = jquery(window)

    const arr = window.$('a')
    const links = []
    let i = 0

    const maxLinks = 1000
    const limit = Math.min(arr.length, maxLinks)
    for (i = 0; i < limit; i++) {
      const href = ($(arr[i]).attr('href') || '').trim()
      const text = ($(arr[i]).text() || '').replace(/\s+/g, ' ').trim()
      const link = { href, text }
      links.push(link)
      if (i % 200 === 0 && timeLeft() < 800) { log('links', 'short circuit'); break }
    }

    Object.assign(article.links, links)
    try { log('analyze', 'In-article links extracted', { count: links.length }) } catch {}
  }

  // Formatted Text (including new lines and spacing for spell check)
  article.processed.text.formatted = await getFormattedText(article.processed.html, article.title.text, article.baseurl, options.htmltotext)

  // HTML Text (spans on each line for spell check line numbers)
  article.processed.text.html = await getHtmlText(article.processed.text.formatted)

  // Raw Text (text prepared for keyword analysis & named entity recongnition)
  article.processed.text.raw = await getRawText(article.processed.html)
  const capForNlp = 20000
  let nlpInput = article.processed.text.raw
  if (nlpInput.length > capForNlp) {
    nlpInput = nlpInput.slice(0, capForNlp)
    log('nlp', 'cap input', { chars: capForNlp })
  }

  try {
    const rawLen = (article.processed.text.raw || '').length
    const wordCount = (article.processed.text.raw || '').trim().split(/\s+/).filter(Boolean).length
    log('analyze', 'Content stats', { chars: rawLen, words: wordCount })
  } catch {}

  // Final paragraph fallback: if still no content, synthesize from first 5 substantial paragraphs
  try {
    const haveRaw = ((article.processed.text.raw || '').length > 0)
    if (!haveRaw) {
      const scope = dom.window.document.querySelector('main, article, [role="main"]') || dom.window.document.body
      let paras = Array.from(scope ? scope.querySelectorAll('p') : [])
        .map(p => ((p && p.textContent) ? p.textContent.replace(/\s+/g,' ').trim() : ''))
        .filter(t => t && t.length > 60)
        .slice(0, 5)
      if (paras.length < 2) {
        // Try AMP live-list items or generic live entries
        const alt = []
        try {
          const nodes = Array.from(dom.window.document.querySelectorAll('amp-live-list [role="article"], amp-live-list article, amp-live-list li, .update, .post')).slice(0, 50)
          for (const n of nodes) {
            const t = (n && n.textContent ? n.textContent.replace(/\s+/g,' ').trim() : '')
            if (t.length > 80) alt.push(t)
            if (alt.length >= 5) break
          }
        } catch {}
        if (alt.length >= 2) paras = alt
      }
      if (paras.length < 2) {
        // Try canonical URL fetch to get non-AMP content
        try {
          const link = dom.window.document.querySelector('link[rel="canonical"]')
            const canon = (link && link.href) ? link.href : null
            if (canon) {
              const res = await undiciFetch(canon, { headers: { 'User-Agent': options.puppeteer?.userAgent || 'Mozilla/5.0', 'Accept-Language': options.puppeteer?.extraHTTPHeaders?.['Accept-Language'] || 'en-US,en;q=0.9' } })
              if (res && res.ok) {
                const txt = await res.text()
                const vcC2 = new VirtualConsole(); vcC2.sendTo(console, { omitJSDOMErrors: true })
                const domC = new JSDOM(txt, { virtualConsole: vcC2 })
                const scopeC = domC.window.document.querySelector('main, article, [role="main"]') || domC.window.document.body
                const p2 = Array.from(scopeC ? scopeC.querySelectorAll('p') : [])
                  .map(p => ((p && p.textContent) ? p.textContent.replace(/\s+/g,' ').trim() : ''))
                  .filter(t => t && t.length > 60)
                  .slice(0, 5)
                if (p2.length >= 2) paras = p2
              }
            }
        } catch {}
      }
      if (paras.length < 2) {
        // As a last generic fallback, re-navigate in the browser context to canonical (dynamic render)
        try {
          const link = dom.window.document.querySelector('link[rel="canonical"]')
          const canon = (link && link.href) ? link.href : null
          if (canon && timeLeft() > 500) {
            log('content', 'canonical retry', { url: canon })
            try { await page.setRequestInterception(false) } catch {}
            try { await page.goto(canon, { waitUntil: 'domcontentloaded', timeout: Math.min(1500, Math.max(300, timeLeft())) }) } catch {}
            try { await waitForFrameStability(page, timeLeft, 300, 1000) } catch (err) { logger.warn('waitForFrameStability failed', err) }
            let htmlC = null
            try { htmlC = await evalWithRetry(async () => page.content()) } catch {}
            if (htmlC) {
              try {
                const vcC3 = new VirtualConsole(); vcC3.sendTo(console, { omitJSDOMErrors: true })
                const domCn = new JSDOM(htmlC, { virtualConsole: vcC3 })
                // Try live blog summary again on canonical
                let rebuilt = null
                let usedEntries = 0
                try {
                  const liveN = buildLiveBlogSummary(domCn.window.document)
                  if (liveN && liveN.ok) { rebuilt = liveN.html; usedEntries = Number(liveN.count || 0) }
                } catch {}
                // Or try paragraph-based summary on canonical
                if (!rebuilt) {
                  const scopeN = domCn.window.document.querySelector('main, article, [role="main"]') || domCn.window.document.body
                  const pN = Array.from(scopeN ? scopeN.querySelectorAll('p') : [])
                    .map(p => ((p && p.textContent) ? p.textContent.replace(/\s+/g,' ').trim() : ''))
                    .filter(t => t && t.length > 60)
                    .slice(0, 5)
                  if (pN.length >= 2) {
                    const parts = ['<div class="live-summary">']
                    for (const pv of pN) parts.push('<div class="entry"><p>' + pv + '</p></div>')
                    parts.push('</div>')
                    rebuilt = parts.join('')
                    usedEntries = pN.length
                  }
                }
                if (rebuilt) {
                  article.processed.html = await absolutify(rebuilt, article.baseurl)
                  article.processed.text.formatted = await getFormattedText(article.processed.html, article.title.text, article.baseurl, options.htmltotext)
                  article.processed.text.html = await getHtmlText(article.processed.text.formatted)
                  article.processed.text.raw = await getRawText(article.processed.html)
                  article.bodySelector = '.live-summary'
                  article.bodyXPath = "/HTML/BODY/DIV[@class=\"live-summary\"]"
                  try {
                    article.meta = article.meta || {}
                    article.meta.liveSummary = { used: true, entries: usedEntries, chars: (article.processed.text.raw || '').length }
                  } catch {}
                  log('content', 'live blog detected; using summary', { entries: usedEntries, chars: (article.processed.text.raw || '').length })
                }
              } catch {}
            }
          }
        } catch {}
      }
      if (paras.length >= 2) {
        const htmlParts = ['<div class="live-summary">']
        for (const pv of paras) htmlParts.push('<div class="entry"><p>' + pv + '</p></div>')
        htmlParts.push('</div>')
        const synth = htmlParts.join('')
        article.processed.html = await absolutify(synth, article.baseurl)
        article.processed.text.formatted = await getFormattedText(article.processed.html, article.title.text, article.baseurl, options.htmltotext)
        article.processed.text.html = await getHtmlText(article.processed.text.formatted)
        article.processed.text.raw = await getRawText(article.processed.html)
        article.bodySelector = '.live-summary'
        article.bodyXPath = "/HTML/BODY/DIV[@class=\"live-summary\"]"
        try {
          article.meta = article.meta || {}
          if (!article.meta.liveSummary) article.meta.liveSummary = { used: true, entries: paras.length }
        } catch {}
        log('content', 'live blog detected; using summary', { entries: paras.length })
      }
    }
  } catch {}

  // Generic rescue for dynamic/live pages yielding too little content (e.g., live blogs)
  try {
    const rawLen = (article.processed.text.raw || '').length
    if (!contentOverridden && !staticHtmlOverride && rawLen < 200 && timeLeft() > 2000) {
      log('rescue', 'Low content detected; retrying detection', { chars: rawLen })
      try { await page.setRequestInterception(false) } catch {}
      try { await sleep(800) } catch {}
      try { await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: Math.min(3000, Math.max(0, timeLeft())) }) } catch {}
      let freshHtml = null
      try { freshHtml = await evalWithRetry(async () => page.content()) } catch { freshHtml = null }
      if (freshHtml) {
        try {
          const vcR = new VirtualConsole(); vcR.sendTo(console, { omitJSDOMErrors: true })
          const domR = new JSDOM(freshHtml, { virtualConsole: vcR })
          const sdR = extractStructuredData(domR.window.document)
          const detR = detectContent(domR.window.document, options, sdR)
          const recovered = detR.html || (domR.window.document.body ? domR.window.document.body.innerHTML : freshHtml)
          article.processed.html = await absolutify(recovered, article.baseurl)
          article.processed.text.formatted = await getFormattedText(article.processed.html, article.title.text, article.baseurl, options.htmltotext)
          article.processed.text.html = await getHtmlText(article.processed.text.formatted)
          article.processed.text.raw = await getRawText(article.processed.html)
          log('rescue', 'Recovered content', { chars: (article.processed.text.raw || '').length })
          // refresh nlp input window
          nlpInput = article.processed.text.raw.length > capForNlp ? article.processed.text.raw.slice(0, capForNlp) : article.processed.text.raw
        } catch {}
      }
    }
  } catch {}

  // Excerpt
  article.excerpt = capitalizeFirstLetter(article.processed.text.raw.replace(/^(.{200}[^\s]*).*/, '$1'))

  // Sentiment
  if (options.enabled.includes('sentiment')) {
    log('analyze', 'Evaluating sentiment')

    const sentiment = new Sentiment()

    article.sentiment = sentiment.analyze(nlpInput)
    try { log('analyze', 'Sentiment evaluated', { score: article.sentiment.score, comparative: article.sentiment.comparative }) } catch {}
    if (article.sentiment.score > 0.05) {
      article.sentiment.result = 'Positive'
    } else if (article.sentiment.score < 0.05) {
      article.sentiment.result = 'Negative'
    } else {
      article.sentiment.result = 'Neutral'
    }
  }

  // Named Entity Recognition
  if (options.enabled.includes('entities') && (!isLiveSummary || timeLeft() > 4000)) {
    log('analyze', 'Extracting named entities')

    // People
    if (timeLeft() < 1200) { log('analyze', 'Skipping NER due to low budget') }
    else {
      article.people = nlp(nlpInput).people().json()
      const seen = Array.isArray(article.people) ? article.people.map(p => String(p.text || '').toLowerCase()) : []
      if (pluginHints.first.length && pluginHints.last.length) {
        const haystack = nlpInput.toLowerCase()
        for (const f of pluginHints.first) {
          for (const l of pluginHints.last) {
            const needle = `${f} ${l}`.toLowerCase()
            if (haystack.includes(needle) && !seen.includes(needle)) {
              if (!Array.isArray(article.people)) article.people = []
              article.people.push({ text: needle.replace(/\b\w/g, c => c.toUpperCase()) })
              seen.push(needle)
            }
          }
        }
      }
    }

    // Places
    if (timeLeft() < 1000) { /* skip places */ }
    else article.places = nlp(nlpInput).places().json()

    // Orgs & Places
    if (timeLeft() < 900) { /* skip orgs */ }
    else article.orgs = nlp(nlpInput).organizations().json()

    // Topics
    if (timeLeft() < 800) { /* skip topics */ }
    else article.topics = nlp(nlpInput).topics().json()
    try {
      const pc = Array.isArray(article.people) ? article.people.length : 0
      const plc = Array.isArray(article.places) ? article.places.length : 0
      const oc = Array.isArray(article.orgs) ? article.orgs.length : 0
      const tc = Array.isArray(article.topics) ? article.topics.length : 0
      log('analyze', 'Entities extracted', { people: pc, places: plc, orgs: oc, topics: tc })
    } catch {}
  }

  // Spelling
  if (options.enabled.includes('spelling') && (!isLiveSummary || timeLeft() > 5000)) {
    log('analyze', 'Checking spelling')
    if (timeLeft() < 2500) { log('analyze', 'Skipping spelling due to low budget') }
    else {
      const capForSpell = 12000
      const spellInput = article.processed.text.formatted.length > capForSpell ? article.processed.text.formatted.slice(0, capForSpell) : article.processed.text.formatted
      if (spellInput.length !== article.processed.text.formatted.length) { log('analyze', 'Capping spelling input', { chars: capForSpell }) }
      article.spelling = await spellCheck(spellInput, options.retextspell)
      try { log('analyze', 'Spelling suggestions generated', { count: Array.isArray(article.spelling) ? article.spelling.length : 0 }) } catch {}
    }

    // Filter spelling results using known entities (people, orgs, places)
    const normalize = (w) => {
      if (typeof w !== 'string') return ''
      return w
        .replace(/[’']/g, '') // remove apostrophes
        .replace(/[^A-Za-z0-9]+/g, ' ') // non-alphanumerics to space
        .trim()
        .toLowerCase()
    }

    const splitWords = (s) => normalize(s).split(/\s+/).filter(Boolean)

    const collectEntityWords = (arr) => {
      const out = []
      if (!Array.isArray(arr)) return out
      for (const e of arr) {
        if (e && typeof e.text === 'string') out.push(...splitWords(e.text))
        if (Array.isArray(e.terms)) {
          for (const t of e.terms) {
            if (t && typeof t.text === 'string') out.push(...splitWords(t.text))
          }
        }
      }
      return out
    }

    const knownWords = new Set([
      ...collectEntityWords(article.people || []),
      ...collectEntityWords(article.orgs || []),
      ...collectEntityWords(article.places || [])
    ])

    if (!Array.isArray(article.spelling)) article.spelling = []
    article.spelling = article.spelling.filter((item) => {
      const word = String(item.word || '')
      const tokens = splitWords(word)
      if (tokens.length === 0) return true
      // consider also singular form if token ends with s
      for (const tok of tokens) {
        const t = tok
        const tSingular = t.endsWith('s') && t.length > 1 ? t.slice(0, -1) : null
        if (knownWords.has(t) || (tSingular && knownWords.has(tSingular))) {
          return false
        }
      }
      return true
    })
  }

  // Evaluate keywords & keyphrases
  if (options.enabled.includes('keywords') && !(isLiveSummary && timeLeft() < 6000)) {
    log('analyze', 'Evaluating keywords and keyphrases')

    // Evaluate meta title keywords & keyphrases
    if (timeLeft() > 500) Object.assign(article.meta.title, await keywordParser(article.meta.title.text, options.retextkeywords))

    // Evaluate derived title keywords & keyphrases
    if (timeLeft() > 500) Object.assign(article.title, await keywordParser(article.title.text, options.retextkeywords))

    // Evaluate meta description keywords & keyphrases
    if (timeLeft() > 500) Object.assign(article.meta.description, await keywordParser(article.meta.description.text, options.retextkeywords))

    // Evaluate processed content keywords & keyphrases
    if (timeLeft() > 600) {
      const kw = await keywordParser(nlpInput, options.retextkeywords)
      Object.assign(article.processed, kw)
      try {
        const kc = Array.isArray(kw.keywords) ? kw.keywords.length : 0
        const pc = Array.isArray(kw.keyphrases) ? kw.keyphrases.length : 0
        log('analyze', 'Keywords extracted', { keywords: kc, keyphrases: pc })
      } catch {}
    }
  }

  log('parse', 'complete', { source: (staticHtmlOverride ? 'amp' : 'dynamic'), elapsed_ms: elapsed(), remaining_ms: tl(), budget_ms: options.timeoutMs || '' })

    return article
  } finally {
    try { await page.close() } catch {}
  }
}

// Legacy title helpers removed; using controllers/titleDetector instead
