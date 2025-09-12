import logger from './logger.js'
import { sanitizeDataUrl } from './utils.js'
import { safeAwait, sleep } from './async.js'

export const timeLeftFactory = (options) => () => {
  try { if (!options.__deadline) return Infinity } catch { return Infinity }
  return Math.max(0, options.__deadline - Date.now())
}

export async function waitForFrameStability (page, timeLeft, quietMs = 400, maxMs = 1500) {
  const start = Date.now()
  const hardDeadline = Math.min(maxMs, Math.max(0, timeLeft()))
  // Wait for the document to be reasonably ready, but tolerate navigations
  while ((Date.now() - start) < hardDeadline) {
    const remaining = hardDeadline - (Date.now() - start)
    const timeout = Math.min(1000, Math.max(200, remaining))
    try {
      await page.waitForFunction(() => document.readyState === 'complete' || document.readyState === 'interactive', { timeout })
      break
    } catch (err) {
      const msg = String(err && err.message || '')
      // If the frame detached (navigation), loop and try again until deadline
      if (/detached frame|Execution context was destroyed|Cannot find context/i.test(msg)) {
        await safeAwait(sleep(60), 'detached-wait')
        continue
      }
      // For other errors, just proceed to quiet period
      break
    }
  }
  // Then wait for a short quiet window since the last navigation/load
  while ((Date.now() - start) < hardDeadline) {
    const sinceNav = Date.now() - (page.__lastNavAt || 0)
    if (sinceNav >= quietMs) break
    const slice = Math.min(120, Math.max(40, quietMs / 4))
    await safeAwait(sleep(slice), 'quiet-wait')
  }
}

export async function navigateWithFallback (page, options, url, timeLeft, log, interceptionActiveRef) {
  if (url.startsWith('data:')) {
    const { html, sanitizedUrl } = sanitizeDataUrl(url, options.puppeteer?.launch?.javascriptEnabled !== false)
    await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 0 })
    return { url: sanitizedUrl, status: 200 }
  }

  const headersBackup = options.puppeteer?.extraHTTPHeaders ? { ...options.puppeteer.extraHTTPHeaders } : {}
  const tryGoto = async (gotoOpts) => page.goto(url, gotoOpts)
  let response
  try {
    const baseTimeout = Math.min(7000, Math.max(3000, timeLeft()))
    const go = Object.assign({ waitUntil: 'domcontentloaded', timeout: baseTimeout }, options.puppeteer.goto || {})
    if (!Number.isFinite(go.timeout)) go.timeout = baseTimeout
    log('nav', 'attempt', { wait_until: go.waitUntil, timeout_ms: go.timeout })
    response = await tryGoto(go)
  } catch (err1) {
    logger.warn('navigation attempt failed', err1)
    try {
      response = await tryGoto({ waitUntil: 'domcontentloaded', timeout: Math.min(5000, Math.max(2500, timeLeft())) })
    } catch (err2) {
      logger.warn('navigation retry failed', err2)
      try {
        await safeAwait(page.setRequestInterception(false), 'disable interception')
        if (interceptionActiveRef) interceptionActiveRef.current = false
        response = await tryGoto({ waitUntil: 'domcontentloaded', timeout: Math.min(4000, Math.max(2000, timeLeft())) })
      } catch (err3) {
        logger.warn('navigation fallback failed', err3)
        await safeAwait(page.setExtraHTTPHeaders({ ...headersBackup, Referer: 'https://www.google.com/' }), 'setExtraHTTPHeaders')
        try {
          response = await tryGoto({ waitUntil: 'domcontentloaded', timeout: Math.min(4000, Math.max(2000, timeLeft())) })
        } catch (err4) {
          log('nav', 'failed', { error: err4.message })
          throw new Error('Failed to fetch ' + url + ': ' + err4.message)
        } finally {
          await safeAwait(page.setExtraHTTPHeaders(headersBackup), 'restore headers')
        }
      }
    }
  }
  return response
}
