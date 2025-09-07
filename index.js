import puppeteer from 'puppeteer-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

puppeteer.use(StealthPlugin())

import fs from 'fs'
import cleaner from 'clean-html'
import Sentiment from 'sentiment'
import { htmlToText } from 'html-to-text'
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

export async function parseArticle (options, socket = { emit: (type, status) => console.log(status) }) {

  options = setDefaultOptions(options)
  // Enforce no-screenshot globally regardless of caller configuration
  try {
    if (Array.isArray(options.enabled)) {
      options.enabled = options.enabled.filter(k => k !== 'screenshot')
    }
  } catch {}

  // Allow nlp plugins to be passed in (https://observablehq.com/@spencermountain/compromise-plugins)
  if (options.nlp.plugins.length >= 1) {
    for (const plugin of options.nlp.plugins) {
      nlp.extend(plugin)
    }
  }

  const browser = await puppeteer.launch(options.puppeteer.launch)

  // Global timeout support for the whole parse operation
  const totalTimeoutMs = Number.isFinite(Number(options.timeoutMs)) ? Number(options.timeoutMs) : null
  const startAt = Date.now()
  const deadline = totalTimeoutMs ? startAt + totalTimeoutMs : null
  if (deadline) options.__deadline = deadline
  let timeoutHandle = null
  let timedOut = false
  const timeoutPromise = new Promise((_, reject) => {
    if (!totalTimeoutMs) return
    timeoutHandle = setTimeout(async () => {
      timedOut = true
      try { await browser.close() } catch {}
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
      try { await browser.close() } catch {}
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
      socket.emit('parse:status', ctx ? `${header} — ${ctx}` : header)
    } catch {}
  }
  const t0 = Date.now()
  const elapsed = () => Date.now() - t0
  log('parse', 'start', { url: options.url, timeout_ms: options.timeoutMs || '' })
  const page = await browser.newPage()

  try {
    // Track frame navigations to wait for brief stability before evaluating
    let __lastNavAt = Date.now()
    try {
      page.on('framenavigated', () => { __lastNavAt = Date.now() })
      page.on('load', () => { __lastNavAt = Date.now() })
      page.on('domcontentloaded', () => { __lastNavAt = Date.now() })
    } catch {}

    // Allow static HTML override (e.g., fetched AMP) when dynamic content is obstructed
    let staticHtmlOverride = null
    let staticUrlOverride = null
    let ampFetchPromise = null

    const timeLeft = () => {
      try { if (!options.__deadline) return Infinity } catch { return Infinity }
      return Math.max(0, options.__deadline - Date.now())
    }

    const waitForFrameStability = async (quietMs = 400, maxMs = 1500) => {
      const start = Date.now()
      const deadline = Math.min(maxMs, timeLeft())
      // Prefer a readyState complete check when possible
      try {
        await page.waitForFunction(() => document.readyState === 'complete', { timeout: Math.min(1200, Math.max(0, timeLeft())) })
      } catch {}
      while ((Date.now() - __lastNavAt) < quietMs && (Date.now() - start) < deadline) {
        const slice = Math.min(120, Math.max(40, quietMs / 4))
        try { await page.waitForTimeout(slice) } catch {}
      }
    }
    // Keep waits proportional to remaining time (helps heavier sites)
    const tl = () => Math.max(0, timeLeft())
    try { await page.setDefaultTimeout(Math.min(5000, Math.max(2500, tl()))) } catch {}
    try { await page.setDefaultNavigationTimeout(Math.min(8000, Math.max(3500, tl()))) } catch {}

    // Optional: disable JavaScript for troublesome sites (via tweaks)
    try {
      if (options.puppeteer && typeof options.puppeteer.javascriptEnabled === 'boolean') {
        await page.setJavaScriptEnabled(Boolean(options.puppeteer.javascriptEnabled))
      }
    } catch {}
    const jsEnabled = !(options.puppeteer && options.puppeteer.javascriptEnabled === false)

    // Ignore content security policies
    await page.setBypassCSP(options.puppeteer.setBypassCSP)

    // Optional: set user agent and extra headers from options
    if (options.puppeteer && options.puppeteer.userAgent) {
      await page.setUserAgent(options.puppeteer.userAgent)
    }
    if (options.puppeteer && options.puppeteer.extraHTTPHeaders) {
      const hdrs = { ...options.puppeteer.extraHTTPHeaders }
      if (!('Referer' in hdrs)) hdrs.Referer = 'https://www.google.com/'
      await page.setExtraHTTPHeaders(hdrs)
    } else {
      try { await page.setExtraHTTPHeaders({ Referer: 'https://www.google.com/' }) } catch {}
    }

    let interceptionActive = false
    let reqTotal = 0
    let reqBlocked = 0
    let reqSkipped = 0
    let reqContinued = 0
    if (!options.noInterception) {
      await page.setRequestInterception(true)
      interceptionActive = true
      try {
        log('intercept', 'enabled', {
          blocked: (options.blockedResourceTypes || []).join(',') || '(none)',
          skipped: (options.skippedResources || []).slice(0, 5).join(',') || '(none)'
        })
      } catch {}

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
        if (interceptionActive && (isBlockedType || isSkippedMatch)) {
          if (isBlockedType) reqBlocked++
          else if (isSkippedMatch) reqSkipped++
          request.abort()
        } else if (interceptionActive) {
          reqContinued++
          request.continue()
        } else {
          // If interception disabled, ignore handler (no continue/abort)
          return
        }
      })
    }

    // Inject jQuery from local package to avoid external network fetch
    const jquerySource = await fs.promises.readFile(
      require.resolve('jquery/dist/jquery.min.js'),
      'utf8'
    )
    try { await page.addScriptTag({ content: jquerySource }) } catch {}

    // Pre-seed cookies if provided (helps bypass consent walls)
    try {
      if (options.puppeteer && Array.isArray(options.puppeteer.cookies) && options.puppeteer.cookies.length) {
        await page.setCookie(...options.puppeteer.cookies)
      }
    } catch {}

    // Adaptive navigation with fallbacks to reduce need for per-domain tweaks
    async function navigateWithFallback(url) {
      const headersBackup = options.puppeteer && options.puppeteer.extraHTTPHeaders ? { ...options.puppeteer.extraHTTPHeaders } : {}
      const tryGoto = async (gotoOpts) => {
        try {
          return await page.goto(url, gotoOpts)
        } catch (err) {
          throw err
        }
      }

      let response
      try {
        const baseTimeout = Math.min(7000, Math.max(3000, tl()))
        const go = Object.assign({ waitUntil: 'domcontentloaded', timeout: baseTimeout }, options.puppeteer.goto || {})
        if (!Number.isFinite(go.timeout)) go.timeout = baseTimeout
        log('nav', 'attempt', { wait_until: go.waitUntil, timeout_ms: go.timeout })
        response = await tryGoto(go)
      } catch (err1) {
        // Fallback 1: relax waitUntil
        try {
          response = await tryGoto({ waitUntil: 'domcontentloaded', timeout: Math.min(5000, Math.max(2500, tl())) })
        } catch (err2) {
          // Fallback 2: disable interception if enabled and retry
          try { await page.setRequestInterception(false); interceptionActive = false } catch {}
          try {
            response = await tryGoto({ waitUntil: 'domcontentloaded', timeout: Math.min(4000, Math.max(2000, tl())) })
          } catch (err3) {
            // Fallback 3: try with a benign Referer (some sites require it)
            try { await page.setExtraHTTPHeaders({ ...(headersBackup || {}), Referer: 'https://www.google.com/' }) } catch {}
            try {
              response = await tryGoto({ waitUntil: 'domcontentloaded', timeout: Math.min(4000, Math.max(2000, tl())) })
            } catch (err4) {
              const message = 'Failed to fetch ' + url + ': ' + err4.message
              log('nav', 'failed', { error: err4.message })
              throw new Error(message)
            } finally {
              // restore headers
              try { await page.setExtraHTTPHeaders(headersBackup || {}) } catch {}
            }
          }
        }
      }

      return response
    }

    let response = await navigateWithFallback(options.url)
    try { await waitForFrameStability(400, 1500) } catch {}

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
        const res = await fetch(u, {
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
        await Promise.race([ampFetchPromise, new Promise(r => setTimeout(r, earlyWait))])
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
  async function autoDismissConsent(page, consentOptions = {}) {
    try {
      const selectors = Array.isArray(consentOptions.selectors) ? consentOptions.selectors : []
      const textPatterns = Array.isArray(consentOptions.textPatterns) ? consentOptions.textPatterns : []
      const maxClicks = Number.isFinite(consentOptions.maxClicks) ? consentOptions.maxClicks : 3
      const waitMs = Number.isFinite(consentOptions.waitAfterClickMs) ? consentOptions.waitAfterClickMs : 500

      const frames = page.frames()
      let clicks = 0

      // Helper to click by selectors in a frame-like context
      const clickSelectorsIn = async (ctx) => {
        for (const sel of selectors) {
          if (clicks >= maxClicks) break
          try {
            const el = await ctx.$(sel)
            if (el) {
              try { await el.evaluate(e => { try { e.scrollIntoView({ block: 'center' }) } catch {} }) } catch {}
              await el.click({ delay: 20 })
              clicks++
              await page.waitForTimeout(waitMs)
            }
          } catch {}
        }
      }

      // Helper to click by text patterns in a frame
      const clickByTextIn = async (frame) => {
        const patterns = textPatterns.map(s => String(s).toLowerCase())
        const remaining = maxClicks - clicks
        if (remaining <= 0 || patterns.length === 0) return
        try {
          const did = await frame.evaluate((patterns, remaining) => {
            const isVisible = (el) => {
              const rect = el.getBoundingClientRect()
              const style = window.getComputedStyle(el)
              return rect.width > 1 && rect.height > 1 && style.visibility !== 'hidden' && style.display !== 'none'
            }
            const isConsentContext = (el) => {
              let n = el
              const re = /(consent|cookie|privacy|gdpr)/i
              while (n && n.nodeType === 1) {
                const id = n.id || ''
                const cls = (n.className && typeof n.className === 'string') ? n.className : ''
                if (re.test(id) || re.test(cls)) return true
                n = n.parentElement
              }
              return false
            }
            const candidates = Array.from(document.querySelectorAll('button, [role="button"], a, div[role="button"]'))
            let count = 0
            for (const el of candidates) {
              if (count >= remaining) break
              const txt = (el.innerText || el.textContent || '').trim().toLowerCase()
              if (!txt) continue
              if (patterns.some(p => txt.includes(p)) && isConsentContext(el)) {
                try { if (isVisible(el)) { el.click(); count++ } } catch {}
              }
            }
            return count
          }, patterns, remaining)
          clicks += Number(did) || 0
          if (did) await page.waitForTimeout(waitMs)
        } catch {}
      }

      // Pass 1: selectors in main frame, then in child frames
      await clickSelectorsIn(page)
      for (const f of frames) { if (clicks < maxClicks) await clickSelectorsIn(f) }

      // Pass 2: text matches in frames
      for (const f of frames) { if (clicks < maxClicks) await clickByTextIn(f) }

      // If clicks may have triggered navigation, wait briefly for it to settle
      if (clicks) {
        try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 2000 }) } catch {}
      }

      // As a last resort, try Escape once to close modal overlays
      try { await page.keyboard.press('Escape') } catch {}
      if (waitMs) await page.waitForTimeout(100)
    } catch {}
  }

  if (!staticHtmlOverride && jsEnabled && options.consent && options.consent.autoDismiss) {
    await autoDismissConsent(page, options.consent)
  }
  try { await waitForFrameStability(350, 1200) } catch {}

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
    const maxMs = Math.min(500, Math.max(300, tl()))
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
          const res = await fetch(u, {
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

  // If AMP fetched, prefer static override for speed and robustness
  try {
    if (ampFetchPromise) {
      const waitMs = Math.min(1500, Math.max(200, Math.floor(tl() * 0.3)))
      try { await Promise.race([ampFetchPromise, new Promise(r => setTimeout(r, waitMs))]) } catch {}
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
    await page.waitForTimeout(400)
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
      await page.waitForTimeout(300)
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
  } catch (err) {
    try { await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 1500 }) } catch {}
    try { article.meta.title.text = await page.title() } catch { article.meta.title.text = '' }
  }

  // Take mobile screenshot
  if (options.enabled.includes('screenshot') && timeLeft() > 300) {
    log('analyze', 'Capturing screenshot')
    try {
      article.mobile = await page.screenshot({ encoding: 'base64', type: 'jpeg', quality: 60 })
    } catch { /* ignore screenshot failures (e.g., page closed on timeout) */ }
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
      try { await waitForFrameStability(400, 1500) } catch {}
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
      try { await navigateWithFallback(options.url) } catch {}
      if (jsEnabled && options.consent && options.consent.autoDismiss) {
        try { await autoDismissConsent(page, options.consent) } catch {}
        try { await waitForFrameStability(400, 1200) } catch {}
      }
      // If still consent-like, try once with JavaScript disabled to avoid dynamic consent flows
      let titleNow = ''
      try { titleNow = await page.title() } catch { titleNow = '' }
      if (/(cookie|cookies|consent|privacy|gdpr)/i.test(String(titleNow))) {
        try { await page.setJavaScriptEnabled(false) } catch {}
        try { await navigateWithFallback(options.url) } catch {}
        try { await waitForFrameStability(400, 1200) } catch {}
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

  // More HTML Cleaning
  html = await htmlCleaner(html, options.cleanhtml)

  // Body Content Identification
log('analyze', 'Evaluating detected content')

  // Readability options no longer used

  const vc1 = new VirtualConsole()
  vc1.sendTo(console, { omitJSDOMErrors: true })
  const dom = new JSDOM(html, { virtualConsole: vc1 })

  // Legacy readability prep removed; using structured/heuristic detection instead

  // Derived Title & Content (structured-data aware detector always enabled)
  const sd = extractStructuredData(dom.window.document)
  const detected = detectContent(dom.window.document, options, sd)
  const { detectTitle } = await import('./controllers/titleDetector.js')
  article.title.text = detectTitle(dom.window.document, sd) || article.title.text
  let content = detected.html
  article.bodySelector = detected.selector || null
  article.bodyXPath = detected.xpath || null

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
            if (override && typeof override === 'string') content = override
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
  if (options.enabled.includes('entities')) {
    log('analyze', 'Extracting named entities')

    // People
    if (timeLeft() < 1200) { log('analyze', 'Skipping NER due to low budget') }
    else article.people = nlp(nlpInput).people().json()

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
  if (options.enabled.includes('spelling')) {
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
  if (options.enabled.includes('keywords')) {
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

/**
 * takes the article body and returns the raw text of the article
 *
 * @param {String} html - the html string to process
 *
 * @return {String} raw text of the article in lower case
 *
 */

const getRawText = function (html) {
  return new Promise(function (resolve) {
    // Lowercase for analysis
    const options = {
      wordwrap: null,
      noLinkBrackets: true,
      ignoreHref: true,
      ignoreImage: true,
      tables: true,
      uppercaseHeadings: false,
      unorderedListItemPrefix: ''
    }

  // HTML > Text
  let rawText = htmlToText(html, options)

  // Normalise
  rawText = nlp(rawText)
  rawText.normalize()
  rawText = rawText.out('text')

  // Remove only square-bracketed segments that contain URL-like text
  const containsUrlLike = (s) => {
    if (!s) return false
    const str = String(s)
    if (/(?:https?:\/\/|ftp:\/\/)/i.test(str)) return true
    if (/\bwww\.[^\s\]]+/i.test(str)) return true
    if (/\b[\w-]+(?:\.[\w-]+)+(?:\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]*)?/i.test(str)) return true
    return false
  }
  rawText = rawText.replace(/\[[^\]]*\]/g, (m) => {
    const inner = m.slice(1, -1)
    return containsUrlLike(inner) ? ' ' : m
  })
  // Globally strip URLs from raw text (protocols, www, and bare domains)
  const stripUrls = (s) => {
    if (!s || typeof s !== 'string') return s
    let out = s.replace(/(?:https?:\/\/|ftp:\/\/)[^\s]+/gi, ' ')
    out = out.replace(/\bwww\.[^\s]+/gi, ' ')
    out = out.replace(/\b(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:[a-z]{2,})(?:\/[\w\-._~:/?#\[\]@!$&'()*+,;=%]*)?/gi, ' ')
    return out
  }
  rawText = stripUrls(rawText)
  rawText = rawText.replace(/\s+/g, ' ').trim()

  resolve(rawText)
  })
}

/**
 * takes the article body and the derived title and returns the formatted text of the article with links made absolute.
 *
 * @param {String} html - the body html string to process
 * @param {String} title - the title string to process
 * @param {String} baseurl - the base url of the page being scraped
 * @param {Object} options - the [htmltotext]{@link https://github.com/werk85/node-html-to-text} formatting options
 *
 * @return {String} formatted text of the article
 *
 */

const getFormattedText = function (html, title, baseurl, options) {
  return new Promise(function (resolve) {
    if (typeof options === 'undefined') {
      options = {
        wordwrap: 100,
        noLinkBrackets: true,
        ignoreHref: true,
        tables: true,
        uppercaseHeadings: true,
        linkHrefBaseUrl: baseurl
      }
    }

    if (typeof options.linkHrefBaseUrl === 'undefined') {
      options.linkHrefBaseUrl = baseurl
    }

    // HTML > Text
    const text = htmlToText(html, options)

    // If uppercase is set uppercase the title
    if (options.uppercaseHeadings === true) {
      title = title.toUpperCase()
    }

    const formattedText = title + '\n\n' + text

    resolve(formattedText)
  })
}

/**
 * takes the formatted article body text and returns the "clean" html text of the article
 *
 * @param {String} text - the formatted text string to process
 *
 * @return {String} the clean html text of the article
 *
 */

const getHtmlText = function (text) {
  return new Promise(function (resolve) {
    // Replace windows line breaks with linux line breaks & split each line into array
    const textArray = text.replace('\r\n', '\n').split('\n')
    // Check length of text array (no of lines)
    const codeLength = textArray.length
    // Wrap each line in a span
    textArray.forEach(function (line, index, array) {
      if (codeLength === index) return
      if (index === 2) line = line.trim()
      array[index] = '<span>' + line + '</span>'
    })
    // Join each line back into a string
    const htmlText = textArray.join('\n')

    // return raw, formatted & html text
    resolve(htmlText)
  })
}

/**
 * takes a string of html and runs it through [clean-html]{@link https://github.com/dave-kennedy/clean-html}
 *
 * @param {String} html - the html to clean
 * @param {Object} options - the [clean-html options]{@link https://github.com/dave-kennedy/clean-html#options}
 *
 * @return {String} the cleaned html
 *
 */

const htmlCleaner = function (html, options) {
  return new Promise(function (resolve) {
    if (typeof options === 'undefined') {
      options = {
        'add-remove-tags': ['blockquote', 'span'],
        'remove-empty-tags': ['span'],
        'replace-nbsp': true
      }
    }

    cleaner.clean(html, options, function (html) {
      resolve(html)
    })
  })
}
// Legacy title helpers removed; using controllers/titleDetector instead
